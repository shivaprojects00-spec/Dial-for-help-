CREATE TABLE IF NOT EXISTS id_counters (
  prefix TEXT PRIMARY KEY,
  last_value BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer', 'service_provider', 'hotel_partner', 'food_partner', 'admin')),
  business_name TEXT,
  city TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_role_idx ON users(role);
CREATE INDEX IF NOT EXISTS users_created_at_idx ON users(created_at DESC);

CREATE TABLE IF NOT EXISTS service_requests (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT UNIQUE NOT NULL,
  requester_user_id BIGINT NOT NULL REFERENCES users(id),
  provider_user_id BIGINT REFERENCES users(id),
  request_type TEXT NOT NULL CHECK (request_type IN ('service', 'hotel', 'food')),
  category TEXT NOT NULL,
  details TEXT NOT NULL,
  city TEXT NOT NULL,
  area TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'in_progress', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS requests_customer_idx ON service_requests(requester_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS requests_provider_idx ON service_requests(provider_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS requests_status_type_idx ON service_requests(status, request_type, created_at DESC);
