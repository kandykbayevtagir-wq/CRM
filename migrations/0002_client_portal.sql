PRAGMA foreign_keys = OFF;

ALTER TABLE organization_settings ADD COLUMN booking_start_time TEXT NOT NULL DEFAULT '09:00';
ALTER TABLE organization_settings ADD COLUMN booking_end_time TEXT NOT NULL DEFAULT '18:00';
ALTER TABLE organization_settings ADD COLUMN booking_slot_interval INTEGER NOT NULL DEFAULT 30;
ALTER TABLE organization_settings ADD COLUMN working_days TEXT NOT NULL DEFAULT '1,2,3,4,5,6';
ALTER TABLE organization_settings ADD COLUMN cancellation_window_hours INTEGER NOT NULL DEFAULT 2;
ALTER TABLE organization_settings ADD COLUMN loyalty_points_per_1000 INTEGER NOT NULL DEFAULT 1;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  username TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'OWNER' CHECK (role IN ('OWNER', 'ADMINISTRATOR', 'SPECIALIST', 'ACCOUNTANT', 'CLIENT')),
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  phone TEXT,
  notifications_allowed INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users_new (id, telegram_id, name, username, avatar_url, role, last_seen_at, created_at, updated_at)
SELECT id, telegram_id, name, username, avatar_url, role, last_seen_at, created_at, updated_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_client_id ON users(client_id) WHERE client_id IS NOT NULL;

ALTER TABLE appointments ADD COLUMN cancel_reason TEXT;
ALTER TABLE appointments ADD COLUMN cancelled_at TEXT;
ALTER TABLE appointments ADD COLUMN confirmed_at TEXT;

CREATE TABLE IF NOT EXISTS employee_schedules (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  starts_time TEXT NOT NULL,
  ends_time TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (employee_id, day_of_week)
);

CREATE TABLE IF NOT EXISTS employee_time_off (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_employee_time_off_range ON employee_time_off(employee_id, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS branch_closures (
  id TEXT PRIMARY KEY,
  branch_id TEXT REFERENCES branches(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS booking_holds (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  starts_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD', 'CONVERTED', 'EXPIRED', 'RELEASED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_holds_active_slot ON booking_holds(employee_id, starts_at) WHERE status = 'HELD';
CREATE INDEX IF NOT EXISTS idx_booking_holds_expiry ON booking_holds(expires_at, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_active_employee_start
  ON appointments(employee_id, starts_at)
  WHERE employee_id IS NOT NULL AND status NOT IN ('CANCELLED', 'NO_SHOW');

CREATE TABLE IF NOT EXISTS appointment_status_history (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_appointment_status_history_appointment ON appointment_status_history(appointment_id, created_at);

CREATE TABLE IF NOT EXISTS client_consents (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('PRIVACY', 'REMINDERS', 'MARKETING', 'PHOTO')),
  version TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  UNIQUE (client_id, kind, version)
);

CREATE TABLE IF NOT EXISTS client_waitlist (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_id TEXT REFERENCES services(id) ON DELETE SET NULL,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  preferred_date TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'OFFERED', 'BOOKED', 'CANCELLED', 'EXPIRED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_client_waitlist_active ON client_waitlist(status, preferred_date);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  sent_at TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'CANCELLED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_queue ON notifications(status, scheduled_at);

CREATE TABLE IF NOT EXISTS loyalty_accounts (
  client_id TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  points_balance INTEGER NOT NULL DEFAULT 0,
  lifetime_points INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  points INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('EARN', 'REDEEM', 'ADJUST')),
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_appointment_earn ON loyalty_transactions(appointment_id, kind) WHERE kind = 'EARN' AND appointment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS client_reviews (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  appointment_id TEXT NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED', 'HIDDEN')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_client_reviews_status ON client_reviews(status, created_at);

PRAGMA foreign_keys = ON;
