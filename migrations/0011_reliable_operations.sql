-- Additive release; no client, visit, payment or ledger records are removed.
ALTER TABLE clients ADD COLUMN profile_notes TEXT;
ALTER TABLE message_outbox ADD COLUMN lease_token TEXT;
ALTER TABLE message_outbox ADD COLUMN lease_expires_at TEXT;
ALTER TABLE message_outbox ADD COLUMN telegram_message_id INTEGER;
CREATE TABLE telegram_updates (
  update_id INTEGER PRIMARY KEY,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE worker_runs (
  worker_name TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  error_code TEXT
);
CREATE INDEX idx_outbox_lease ON message_outbox(status, lease_expires_at);
CREATE INDEX idx_updates_received ON telegram_updates(received_at);
CREATE TRIGGER appointment_overlap_insert BEFORE INSERT ON appointments
WHEN NEW.status NOT IN ('CANCELLED', 'NO_SHOW') AND EXISTS (
  SELECT 1 FROM appointments a WHERE a.employee_id = NEW.employee_id
    AND a.status NOT IN ('CANCELLED', 'NO_SHOW')
    AND julianday(a.starts_at) < julianday(NEW.ends_at)
    AND julianday(COALESCE(a.ends_at, datetime(a.starts_at, '+60 minutes'))) > julianday(NEW.starts_at)
)
BEGIN SELECT RAISE(ABORT, 'CRM_SLOT_UNAVAILABLE'); END;
CREATE TRIGGER appointment_overlap_update BEFORE UPDATE OF starts_at, ends_at, employee_id, status ON appointments
WHEN NEW.status NOT IN ('CANCELLED', 'NO_SHOW') AND EXISTS (
  SELECT 1 FROM appointments a WHERE a.id <> NEW.id AND a.employee_id = NEW.employee_id
    AND a.status NOT IN ('CANCELLED', 'NO_SHOW')
    AND julianday(a.starts_at) < julianday(NEW.ends_at)
    AND julianday(COALESCE(a.ends_at, datetime(a.starts_at, '+60 minutes'))) > julianday(NEW.starts_at)
)
BEGIN SELECT RAISE(ABORT, 'CRM_SLOT_UNAVAILABLE'); END;
CREATE TRIGGER appointment_terminal_immutable BEFORE UPDATE ON appointments
WHEN OLD.status = 'COMPLETED' AND (
  NEW.status <> OLD.status OR NEW.client_id IS NOT OLD.client_id OR
  NEW.employee_id IS NOT OLD.employee_id OR NEW.branch_id IS NOT OLD.branch_id OR
  NEW.starts_at IS NOT OLD.starts_at OR NEW.ends_at IS NOT OLD.ends_at OR NEW.total_amount <> OLD.total_amount
)
BEGIN SELECT RAISE(ABORT, 'CRM_VISIT_CLOSED'); END;
CREATE TRIGGER payment_positive_insert BEFORE INSERT ON payments
WHEN NEW.amount <= 0 OR abs(NEW.amount * 100 - round(NEW.amount * 100)) > 0.00001
BEGIN SELECT RAISE(ABORT, 'CRM_INVALID_MONEY'); END;
CREATE TRIGGER payment_appointment_revision AFTER INSERT ON payments
BEGIN
  UPDATE appointments SET revision = revision + 1 WHERE id = NEW.appointment_id;
  UPDATE payroll_periods SET status = 'DRAFT', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'CALCULATED' AND julianday(NEW.paid_at) >= julianday(period_start) AND julianday(NEW.paid_at) < julianday(period_end);
END;
CREATE TRIGGER refund_appointment_revision AFTER INSERT ON payment_adjustments
BEGIN
  UPDATE appointments SET revision = revision + 1 WHERE id = NEW.appointment_id;
  UPDATE payroll_periods SET status = 'DRAFT', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'CALCULATED' AND julianday(NEW.occurred_at) >= julianday(period_start) AND julianday(NEW.occurred_at) < julianday(period_end);
END;
CREATE TRIGGER client_phone_insert BEFORE INSERT ON clients
WHEN NEW.is_active = 1 AND NEW.phone_normalized <> '' AND EXISTS(
  SELECT 1 FROM clients c WHERE c.is_active = 1 AND c.phone_normalized = NEW.phone_normalized
)
BEGIN SELECT RAISE(ABORT, 'CRM_DUPLICATE_PHONE'); END;
CREATE TRIGGER client_phone_update BEFORE UPDATE OF phone_normalized, is_active ON clients
WHEN NEW.is_active = 1 AND NEW.phone_normalized <> '' AND EXISTS(
  SELECT 1 FROM clients c WHERE c.id <> NEW.id AND c.is_active = 1 AND c.phone_normalized = NEW.phone_normalized
)
BEGIN SELECT RAISE(ABORT, 'CRM_DUPLICATE_PHONE'); END;
CREATE TRIGGER loyalty_balance_insert AFTER INSERT ON loyalty_transactions
BEGIN
  INSERT OR IGNORE INTO loyalty_accounts(client_id, points_balance, lifetime_points) VALUES(NEW.client_id, 0, 0);
  UPDATE loyalty_accounts SET points_balance = points_balance + NEW.points,
    lifetime_points = lifetime_points + CASE WHEN NEW.kind = 'EARN' THEN NEW.points ELSE 0 END,
    updated_at = CURRENT_TIMESTAMP WHERE client_id = NEW.client_id;
END;
INSERT OR IGNORE INTO notification_templates(id, template_key, name, body) VALUES
 ('template-reminder-24', 'REMINDER_24H', 'Напоминание за сутки', 'Напоминаем о визите завтра: {date} в {time}. {service}. Специалист: {specialist}. Филиал: {branch}.'),
 ('template-reminder-2', 'REMINDER_2H', 'Напоминание за два часа', 'Ваш визит через 2 часа: {date} в {time}. {service}. Специалист: {specialist}. Филиал: {branch}.');
