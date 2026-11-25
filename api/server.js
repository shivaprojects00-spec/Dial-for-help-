require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { rateLimit } = require("express-rate-limit");
const { z } = require("zod");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "20kb" }));

const allowedOrigins = (process.env.FRONTEND_ORIGINS || "http://localhost:3000")
  .split(",").map((value) => value.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS"));
  },
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." }
});

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    })
  : null;

let dbReady = false;

function requireDatabase(req, res, next) {
  if (!pool || !dbReady) {
    return res.status(503).json({ error: "The database is not ready yet. Please try again shortly." });
  }
  next();
}

function requireJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    const error = new Error("Authentication is not configured on this server.");
    error.status = 503;
    throw error;
  }
  return secret;
}

function createToken(user) {
  return jwt.sign(
    { sub: String(user.id), role: user.role, publicId: user.public_id },
    requireJwtSecret(),
    { expiresIn: "7d", issuer: "dial-for-help-api", audience: "dial-for-help" }
  );
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Please sign in to continue." });

  try {
    const payload = jwt.verify(token, requireJwtSecret(), {
      issuer: "dial-for-help-api",
      audience: "dial-for-help"
    });
    req.auth = { userId: Number(payload.sub), role: payload.role, publicId: payload.publicId };
    return next();
  } catch (error) {
    return res.status(error.status || 401).json({
      error: error.status === 503 ? error.message : "Your session is invalid or has expired."
    });
  }
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ error: "You do not have permission to perform this action." });
    }
    next();
  };
}

async function nextPublicId(client, prefix) {
  const result = await client.query(
    `INSERT INTO id_counters(prefix, last_value) VALUES ($1, 1)
     ON CONFLICT(prefix) DO UPDATE SET last_value = id_counters.last_value + 1
     RETURNING last_value`,
    [prefix]
  );
  return `DHP-${prefix}-${String(result.rows[0].last_value).padStart(6, "0")}`;
}

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(8).max(20).regex(/^[0-9+() .-]+$/),
  password: z.string().min(10).max(72),
  role: z.enum(["customer", "service_provider", "hotel_partner", "food_partner"]),
  businessName: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2).max(80).optional()
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(72)
});

const requestSchema = z.object({
  requestType: z.enum(["service", "hotel", "food"]),
  category: z.string().trim().min(2).max(80),
  details: z.string().trim().min(5).max(1200),
  city: z.string().trim().min(2).max(80),
  area: z.string().trim().max(100).optional()
});

function userView(user) {
  return {
    id: user.public_id,
    name: user.full_name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    businessName: user.business_name || null,
    city: user.city || null,
    createdAt: user.created_at
  };
}

async function initializeDatabase() {
  if (!pool) {
    console.warn("DATABASE_URL is not configured; API is running in setup mode.");
    return;
  }

  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
  dbReady = true;

  // Admin accounts can only be bootstrapped through private Render environment variables.
  // There is intentionally no public admin registration route.
  const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "";
  const adminName = (process.env.ADMIN_NAME || "Dial for Help Admin").trim();

  if (adminEmail && adminPassword.length >= 12) {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [adminEmail]);
    if (existing.rowCount === 0) {
      const hash = await bcrypt.hash(adminPassword, 12);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const publicId = await nextPublicId(client, "A");
        await client.query(
          `INSERT INTO users(public_id, full_name, email, phone, password_hash, role)
           VALUES($1, $2, $3, $4, $5, 'admin')`,
          [publicId, adminName, adminEmail, "Not provided", hash]
        );
        await client.query("COMMIT");
        console.log("Initial admin account created from server environment configuration.");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  }
}

app.get("/health", async (req, res) => {
  if (!pool) return res.status(200).json({ status: "ok", database: "not_configured" });
  try {
    await pool.query("SELECT 1");
    return res.status(200).json({ status: "ok", database: dbReady ? "connected" : "initializing" });
  } catch {
    return res.status(503).json({ status: "starting", database: "unavailable" });
  }
});

app.get("/api/v1", (req, res) => {
  res.json({ name: "Dial for Help API", version: "1.0.0", status: "available" });
});

app.post("/api/v1/auth/register", authLimiter, requireDatabase, async (req, res, next) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Please check the registration details.", fields: parsed.error.flatten().fieldErrors });
  }

  const data = parsed.data;
  if (["service_provider", "hotel_partner", "food_partner"].includes(data.role) &&
      (!data.businessName || !data.city)) {
    return res.status(400).json({ error: "Partner registration requires a business name and city." });
  }

  const email = data.email.toLowerCase();
  const prefix = { customer: "C", service_provider: "S", hotel_partner: "H", food_partner: "F" }[data.role];
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "An account with this email already exists." });
    }

    const publicId = await nextPublicId(client, prefix);
    const passwordHash = await bcrypt.hash(data.password, 12);
    const result = await client.query(
      `INSERT INTO users(public_id, full_name, email, phone, password_hash, role, business_name, city)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, public_id, full_name, email, phone, role, business_name, city, created_at`,
      [publicId, data.fullName, email, data.phone, passwordHash, data.role, data.businessName || null, data.city || null]
    );
    await client.query("COMMIT");
    const user = result.rows[0];
    return res.status(201).json({ message: "Account created successfully.", user: userView(user), token: createToken(user) });
  } catch (error) {
    await client.query("ROLLBACK");
    return next(error);
  } finally {
    client.release();
  }
});

app.post("/api/v1/auth/login", authLimiter, requireDatabase, async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid email and password." });

  try {
    const result = await pool.query(
      `SELECT id, public_id, full_name, email, phone, password_hash, role, business_name, city, created_at, is_active
       FROM users WHERE email = $1`,
      [parsed.data.email.toLowerCase()]
    );
    const user = result.rows[0];
    if (!user || !user.is_active || !(await bcrypt.compare(parsed.data.password, user.password_hash))) {
      return res.status(401).json({ error: "Email or password is incorrect." });
    }
    return res.json({ message: "Signed in successfully.", user: userView(user), token: createToken(user) });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/v1/auth/me", requireDatabase, authenticate, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT public_id, full_name, email, phone, role, business_name, city, created_at
       FROM users WHERE id = $1 AND is_active = TRUE`,
      [req.auth.userId]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Account not found." });
    return res.json({ user: userView(result.rows[0]) });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/v1/requests", requireDatabase, authenticate, allowRoles("customer"), async (req, res, next) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Please check the request details.", fields: parsed.error.flatten().fieldErrors });
  }

  const data = parsed.data;
  const expectedType = { hotel: "hotel_partner", food: "food_partner", service: "service_provider" }[data.requestType];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const publicId = await nextPublicId(client, "R");
    const result = await client.query(
      `INSERT INTO service_requests(public_id, requester_user_id, request_type, category, details, city, area)
       VALUES($1, $2, $3, $4, $5, $6, $7)
       RETURNING public_id, request_type, category, details, city, area, status, created_at`,
      [publicId, req.auth.userId, data.requestType, data.category, data.details, data.city, data.area || null]
    );
    await client.query("COMMIT");
    return res.status(201).json({ message: "Your request has been received.", request: result.rows[0], matchingPartnerRole: expectedType });
  } catch (error) {
    await client.query("ROLLBACK");
    return next(error);
  } finally {
    client.release();
  }
});

app.get("/api/v1/requests/mine", requireDatabase, authenticate, allowRoles("customer"), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT r.public_id, r.request_type, r.category, r.details, r.city, r.area, r.status, r.created_at,
              p.public_id AS provider_id, p.full_name AS provider_name, p.business_name AS provider_business
       FROM service_requests r
       LEFT JOIN users p ON p.id = r.provider_user_id
       WHERE r.requester_user_id = $1
       ORDER BY r.created_at DESC LIMIT 50`,
      [req.auth.userId]
    );
    return res.json({ requests: result.rows });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/v1/provider/requests", requireDatabase, authenticate, allowRoles("service_provider", "hotel_partner", "food_partner"), async (req, res, next) => {
  const requestType = { service_provider: "service", hotel_partner: "hotel", food_partner: "food" }[req.auth.role];
  try {
    const result = await pool.query(
      `SELECT r.public_id, r.request_type, r.category, r.details, r.city, r.area, r.status, r.created_at,
              CASE WHEN r.provider_user_id = $2 THEN u.full_name ELSE NULL END AS customer_name,
              CASE WHEN r.provider_user_id = $2 THEN u.phone ELSE NULL END AS customer_phone
       FROM service_requests r
       JOIN users u ON u.id = r.requester_user_id
       WHERE r.request_type = $1
         AND (r.status = 'pending' OR r.provider_user_id = $2)
       ORDER BY r.created_at DESC LIMIT 50`,
      [requestType, req.auth.userId]
    );
    return res.json({ requests: result.rows });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/v1/provider/requests/:publicId/accept", requireDatabase, authenticate, allowRoles("service_provider", "hotel_partner", "food_partner"), async (req, res, next) => {
  const requestType = { service_provider: "service", hotel_partner: "hotel", food_partner: "food" }[req.auth.role];
  try {
    const result = await pool.query(
      `UPDATE service_requests
       SET provider_user_id = $1, status = 'accepted', updated_at = NOW()
       WHERE public_id = $2 AND request_type = $3 AND status = 'pending' AND provider_user_id IS NULL
       RETURNING public_id, status, updated_at`,
      [req.auth.userId, req.params.publicId, requestType]
    );
    if (!result.rowCount) return res.status(409).json({ error: "This request is no longer available." });
    return res.json({ message: "Request accepted.", request: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

app.patch("/api/v1/provider/requests/:publicId/status", requireDatabase, authenticate, allowRoles("service_provider", "hotel_partner", "food_partner"), async (req, res, next) => {
  const statusSchema = z.object({ status: z.enum(["in_progress", "completed", "cancelled"]) });
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a valid request status." });

  try {
    const result = await pool.query(
      `UPDATE service_requests SET status = $1, updated_at = NOW()
       WHERE public_id = $2 AND provider_user_id = $3 AND status IN ('accepted', 'in_progress')
       RETURNING public_id, status, updated_at`,
      [parsed.data.status, req.params.publicId, req.auth.userId]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Assigned request not found." });
    return res.json({ message: "Request status updated.", request: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/v1/admin/users", requireDatabase, authenticate, allowRoles("admin"), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT public_id, full_name, email, phone, role, business_name, city, is_active, created_at
       FROM users ORDER BY created_at DESC LIMIT 200`
    );
    return res.json({ users: result.rows });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/v1/admin/requests", requireDatabase, authenticate, allowRoles("admin"), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT r.public_id, r.request_type, r.category, r.details, r.city, r.area, r.status, r.created_at,
              c.public_id AS customer_id, c.full_name AS customer_name, c.phone AS customer_phone,
              p.public_id AS provider_id, p.full_name AS provider_name
       FROM service_requests r
       JOIN users c ON c.id = r.requester_user_id
       LEFT JOIN users p ON p.id = r.provider_user_id
       ORDER BY r.created_at DESC LIMIT 200`
    );
    return res.json({ requests: result.rows });
  } catch (error) {
    return next(error);
  }
});

app.use((req, res) => res.status(404).json({ error: "Endpoint not found." }));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.message === "Origin is not allowed by CORS") {
    return res.status(403).json({ error: "This website origin is not allowed." });
  }
  console.error("API request failed:", error.message);
  return res.status(error.status || 500).json({
    error: error.status ? error.message : "Something went wrong. Please try again."
  });
});

const port = Number(process.env.PORT) || 10000;

initializeDatabase()
  .then(() => {
    app.listen(port, "0.0.0.0", () => console.log(`Dial for Help API listening on port ${port}`));
  })
  .catch((error) => {
    console.error("API startup failed:", error.message);
    process.exit(1);
  });

process.on("SIGTERM", async () => {
  if (pool) await pool.end();
  process.exit(0);
});
