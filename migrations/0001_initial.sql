PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organization_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  brand_name TEXT NOT NULL DEFAULT 'podologymk',
  currency TEXT NOT NULL DEFAULT 'KZT',
  timezone TEXT NOT NULL DEFAULT 'Asia/Almaty',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO organization_settings (id, brand_name, currency, timezone)
VALUES (1, 'podologymk', 'KZT', 'Asia/Almaty');

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  username TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'OWNER' CHECK (role IN ('OWNER', 'ADMINISTRATOR', 'SPECIALIST', 'ACCOUNTANT')),
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_clients_full_name ON clients (full_name);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients (phone);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  position TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  fixed_salary REAL NOT NULL DEFAULT 0,
  revenue_percent REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_employees_branch_id ON employees (branch_id);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Подология',
  price REAL NOT NULL DEFAULT 0,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  starts_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
  total_amount REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_appointments_starts_at ON appointments (starts_at);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments (status);

CREATE TABLE IF NOT EXISTS appointment_services (
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  price REAL NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (appointment_id, service_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  amount REAL NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'CASH' CHECK (method IN ('CASH', 'CARD', 'TRANSFER', 'OTHER')),
  paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS expense_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('RENT', 'UTILITIES', 'SALARY', 'SUPPLIES', 'MARKETING', 'TAX', 'EQUIPMENT', 'OTHER')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  amount REAL NOT NULL DEFAULT 0,
  occurred_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PAID' CHECK (status IN ('PAID', 'PLANNED')),
  description TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_expenses_occurred_at ON expenses (occurred_at);

CREATE TABLE IF NOT EXISTS rent_payments (
  id TEXT PRIMARY KEY,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  period_start TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  due_date TEXT NOT NULL,
  paid_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS utility_payments (
  id TEXT PRIMARY KEY,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  period_start TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  due_date TEXT NOT NULL,
  paid_at TEXT,
  meter_value REAL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payroll_periods (
  id TEXT PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CALCULATED', 'CLOSED')),
  total_amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (period_start, period_end)
);

CREATE TABLE IF NOT EXISTS payroll_lines (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  fixed_amount REAL NOT NULL DEFAULT 0,
  revenue_amount REAL NOT NULL DEFAULT 0,
  bonus_amount REAL NOT NULL DEFAULT 0,
  deduction_amount REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL DEFAULT 0,
  UNIQUE (period_id, employee_id)
);

CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period_id TEXT REFERENCES payroll_periods(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('BONUS', 'DEDUCTION', 'ADVANCE', 'MANUAL')),
  amount REAL NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
