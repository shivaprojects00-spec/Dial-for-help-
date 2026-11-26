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


-- Public customer enquiries are stored separately so customers do not need provider accounts.
CREATE TABLE IF NOT EXISTS guest_requests (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  request_type TEXT NOT NULL CHECK (request_type IN ('service', 'hotel', 'food')),
  category TEXT NOT NULL,
  details TEXT NOT NULL,
  city TEXT NOT NULL,
  area TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'provider_contacted', 'availability_confirmed', 'booking_confirmed', 'completed', 'cancelled')),
  admin_notes TEXT,
  provider_name TEXT,
  quoted_price TEXT,
  appointment_time TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS guest_requests_created_idx ON guest_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS guest_requests_status_idx ON guest_requests(status, created_at DESC);


-- Admin-managed provider directory. Customer-facing APIs never expose this table.
CREATE TABLE IF NOT EXISTS provider_contacts (
  id BIGSERIAL PRIMARY KEY,
  provider_name TEXT NOT NULL,
  business_name TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  category TEXT NOT NULL,
  city TEXT NOT NULL,
  availability TEXT,
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS provider_contacts_city_category_idx ON provider_contacts(city, category);


-- Durable contact messages and private admin/customer chat history.
CREATE TABLE IF NOT EXISTS contact_messages (
  id BIGSERIAL PRIMARY KEY,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS contact_messages_created_idx ON contact_messages(created_at DESC);

CREATE TABLE IF NOT EXISTS guest_chat_messages (
  id BIGSERIAL PRIMARY KEY,
  guest_request_id BIGINT NOT NULL REFERENCES guest_requests(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('customer','admin')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS guest_chat_messages_thread_idx ON guest_chat_messages(guest_request_id, created_at);
