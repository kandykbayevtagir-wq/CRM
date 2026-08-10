PRAGMA foreign_keys = OFF;

ALTER TABLE users ADD COLUMN telegram_username TEXT;
ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN last_login_at TEXT;
UPDATE users SET telegram_username = username WHERE telegram_username IS NULL;

ALTER TABLE clients ADD COLUMN phone_normalized TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE clients ADD COLUMN archived_at TEXT;
ALTER TABLE clients ADD COLUMN archived_by TEXT REFERENCES users(id) ON DELETE SET NULL;
UPDATE clients
SET phone_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '')
WHERE phone_normalized = '';
CREATE INDEX IF NOT EXISTS idx_clients_phone_normalized ON clients(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_clients_active_updated ON clients(is_active, updated_at);

ALTER TABLE services ADD COLUMN cost REAL NOT NULL DEFAULT 0;

ALTER TABLE employees ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_user_id ON employees(user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS employee_branches (
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (employee_id, branch_id)
);
INSERT OR IGNORE INTO employee_branches (employee_id, branch_id, is_primary)
SELECT id, branch_id, 1 FROM employees WHERE branch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employee_branches_branch ON employee_branches(branch_id, employee_id);

ALTER TABLE employee_schedules ADD COLUMN break_start_time TEXT;
ALTER TABLE employee_schedules ADD COLUMN break_end_time TEXT;

ALTER TABLE appointments ADD COLUMN ends_at TEXT;
ALTER TABLE appointments ADD COLUMN source TEXT NOT NULL DEFAULT 'ADMIN';
ALTER TABLE appointments ADD COLUMN changed_by TEXT REFERENCES users(id) ON DELETE SET NULL;
UPDATE appointments
SET ends_at = datetime(starts_at, '+' || COALESCE((
  SELECT SUM(s.duration_minutes * aps.quantity)
  FROM appointment_services aps INNER JOIN services s ON s.id = aps.service_id
  WHERE aps.appointment_id = appointments.id
), 60) || ' minutes')
WHERE ends_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_employee_range ON appointments(employee_id, starts_at, ends_at);

ALTER TABLE appointment_services ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 60;
UPDATE appointment_services
SET duration_minutes = COALESCE((SELECT duration_minutes FROM services WHERE services.id = appointment_services.service_id), 60)
WHERE duration_minutes = 60;

ALTER TABLE payments ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'POSTED' CHECK (payment_status IN ('POSTED', 'VOIDED'));
ALTER TABLE payments ADD COLUMN note TEXT;
ALTER TABLE payments ADD COLUMN created_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS payment_adjustments (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('REFUND', 'CORRECTION')),
  amount REAL NOT NULL CHECK (amount >= 0),
  reason TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payment_adjustments_appointment ON payment_adjustments(appointment_id, occurred_at);

ALTER TABLE expenses ADD COLUMN ledger_transaction_id TEXT;
ALTER TABLE rent_payments ADD COLUMN status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'DUE', 'PAID', 'OVERDUE'));
ALTER TABLE rent_payments ADD COLUMN ledger_transaction_id TEXT;
ALTER TABLE utility_payments ADD COLUMN previous_meter_value REAL;
ALTER TABLE utility_payments ADD COLUMN current_meter_value REAL;
ALTER TABLE utility_payments ADD COLUMN consumption REAL;
ALTER TABLE utility_payments ADD COLUMN tariff REAL NOT NULL DEFAULT 0;
ALTER TABLE utility_payments ADD COLUMN fixed_fee REAL NOT NULL DEFAULT 0;
ALTER TABLE utility_payments ADD COLUMN status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'DUE', 'PAID', 'OVERDUE'));
ALTER TABLE utility_payments ADD COLUMN ledger_transaction_id TEXT;
UPDATE utility_payments SET current_meter_value = meter_value WHERE current_meter_value IS NULL;
UPDATE utility_payments
SET consumption = CASE WHEN current_meter_value IS NOT NULL AND previous_meter_value IS NOT NULL
  THEN MAX(current_meter_value - previous_meter_value, 0) ELSE NULL END,
  amount = CASE WHEN current_meter_value IS NOT NULL AND previous_meter_value IS NOT NULL
    THEN MAX(current_meter_value - previous_meter_value, 0) * tariff + fixed_fee ELSE amount END;
UPDATE rent_payments SET status = CASE WHEN paid_at IS NOT NULL THEN 'PAID' WHEN due_date < date('now') THEN 'OVERDUE' ELSE 'PLANNED' END;
UPDATE utility_payments SET status = CASE WHEN paid_at IS NOT NULL THEN 'PAID' WHEN due_date < date('now') THEN 'OVERDUE' ELSE 'PLANNED' END;

ALTER TABLE payroll_periods ADD COLUMN closed_at TEXT;
ALTER TABLE payroll_periods ADD COLUMN closed_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE payroll_periods ADD COLUMN ledger_transaction_id TEXT;
ALTER TABLE payroll_lines ADD COLUMN revenue_base REAL NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN revenue_percent REAL NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN advance_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN manual_adjustment_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN details_json TEXT;
ALTER TABLE payroll_adjustments ADD COLUMN created_by TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS financial_transactions (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL CHECK (direction IN ('INCOME', 'EXPENSE')),
  kind TEXT NOT NULL CHECK (kind IN ('PAYMENT', 'REFUND', 'EXPENSE', 'RENT', 'UTILITIES', 'SALARY', 'OTHER')),
  category TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'VOIDED', 'PLANNED')),
  occurred_at TEXT NOT NULL,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  payment_id TEXT REFERENCES payments(id) ON DELETE SET NULL,
  expense_id TEXT REFERENCES expenses(id) ON DELETE SET NULL,
  rent_payment_id TEXT REFERENCES rent_payments(id) ON DELETE SET NULL,
  utility_payment_id TEXT REFERENCES utility_payments(id) ON DELETE SET NULL,
  payroll_period_id TEXT REFERENCES payroll_periods(id) ON DELETE SET NULL,
  description TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_period ON financial_transactions(occurred_at, status, direction);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_branch ON financial_transactions(branch_id, occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_transactions_payment ON financial_transactions(payment_id, kind) WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_transactions_expense ON financial_transactions(expense_id, kind) WHERE expense_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_transactions_rent ON financial_transactions(rent_payment_id, kind) WHERE rent_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_transactions_utility ON financial_transactions(utility_payment_id, kind) WHERE utility_payment_id IS NOT NULL;

INSERT OR IGNORE INTO financial_transactions
  (id, direction, kind, category, amount, status, occurred_at, branch_id, appointment_id, payment_id, description)
SELECT 'legacy-payment-' || p.id, 'INCOME', 'PAYMENT', 'PAYMENT', p.amount, p.payment_status, p.paid_at, a.branch_id, p.appointment_id, p.id, 'Историческая оплата'
FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id;

INSERT OR IGNORE INTO financial_transactions
  (id, direction, kind, category, amount, status, occurred_at, branch_id, expense_id, description, created_by)
SELECT 'legacy-expense-' || x.id, 'EXPENSE', 'EXPENSE', x.category, x.amount,
  CASE WHEN x.status = 'PAID' THEN 'POSTED' ELSE 'PLANNED' END, x.occurred_at, x.branch_id, x.id, x.title, x.created_by
FROM expenses x;
UPDATE expenses SET ledger_transaction_id = 'legacy-expense-' || id WHERE ledger_transaction_id IS NULL;

INSERT OR IGNORE INTO financial_transactions
  (id, direction, kind, category, amount, status, occurred_at, branch_id, rent_payment_id, description)
SELECT 'legacy-rent-' || r.id, 'EXPENSE', 'RENT', 'RENT', r.amount,
  CASE WHEN r.status = 'PAID' THEN 'POSTED' ELSE r.status END, COALESCE(r.paid_at, r.due_date), r.branch_id, r.id, r.note
FROM rent_payments r WHERE r.paid_at IS NOT NULL;
UPDATE rent_payments SET ledger_transaction_id = 'legacy-rent-' || id WHERE paid_at IS NOT NULL AND ledger_transaction_id IS NULL;

INSERT OR IGNORE INTO financial_transactions
  (id, direction, kind, category, amount, status, occurred_at, branch_id, utility_payment_id, description)
SELECT 'legacy-utility-' || u.id, 'EXPENSE', 'UTILITIES', 'UTILITIES', u.amount,
  CASE WHEN u.status = 'PAID' THEN 'POSTED' ELSE u.status END, COALESCE(u.paid_at, u.due_date), u.branch_id, u.id, u.note
FROM utility_payments u WHERE u.paid_at IS NOT NULL;
UPDATE utility_payments SET ledger_transaction_id = 'legacy-utility-' || id WHERE paid_at IS NOT NULL AND ledger_transaction_id IS NULL;

PRAGMA foreign_keys = ON;
