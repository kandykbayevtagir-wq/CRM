-- Additive recovery release. Historical records and closed payroll snapshots are retained.
CREATE TABLE mutation_receipts (
  actor_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(actor_id, operation, idempotency_key)
);
ALTER TABLE worker_runs ADD COLUMN lease_token TEXT;
ALTER TABLE worker_runs ADD COLUMN lease_expires_at TEXT;
ALTER TABLE expenses ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER expenses_revision AFTER UPDATE ON expenses
WHEN NEW.revision = OLD.revision
BEGIN UPDATE expenses SET revision = OLD.revision + 1 WHERE id = OLD.id; END;
ALTER TABLE rent_payments ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE utility_payments ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER rent_revision AFTER UPDATE ON rent_payments
WHEN NEW.revision = OLD.revision
BEGIN UPDATE rent_payments SET revision = OLD.revision + 1 WHERE id = OLD.id; END;
CREATE TRIGGER utility_revision AFTER UPDATE ON utility_payments
WHEN NEW.revision = OLD.revision
BEGIN UPDATE utility_payments SET revision = OLD.revision + 1 WHERE id = OLD.id; END;

-- Invalidate DRAFT too: calculations read a revision before collecting their inputs.
DROP TRIGGER IF EXISTS payment_appointment_revision;
CREATE TRIGGER payment_appointment_revision AFTER INSERT ON payments
BEGIN
  UPDATE appointments SET revision = revision + 1 WHERE id = NEW.appointment_id;
  UPDATE payroll_periods SET status = 'DRAFT', updated_at = CURRENT_TIMESTAMP
    WHERE status <> 'CLOSED' AND julianday(NEW.paid_at) >= julianday(period_start) AND julianday(NEW.paid_at) < julianday(period_end);
END;
DROP TRIGGER IF EXISTS refund_appointment_revision;
CREATE TRIGGER refund_appointment_revision AFTER INSERT ON payment_adjustments
BEGIN
  UPDATE appointments SET revision = revision + 1 WHERE id = NEW.appointment_id;
  UPDATE payroll_periods SET status = 'DRAFT', updated_at = CURRENT_TIMESTAMP
    WHERE status <> 'CLOSED' AND julianday(NEW.occurred_at) >= julianday(period_start) AND julianday(NEW.occurred_at) < julianday(period_end);
END;
CREATE TRIGGER appointment_payroll_invalidate AFTER UPDATE OF status, employee_id ON appointments
WHEN NEW.status IS NOT OLD.status OR NEW.employee_id IS NOT OLD.employee_id
BEGIN
  UPDATE payroll_periods SET status = 'DRAFT', updated_at = CURRENT_TIMESTAMP
    WHERE status <> 'CLOSED' AND (
      EXISTS(SELECT 1 FROM payments p WHERE p.appointment_id = NEW.id AND julianday(p.paid_at) >= julianday(period_start) AND julianday(p.paid_at) < julianday(period_end))
      OR EXISTS(SELECT 1 FROM payment_adjustments pa WHERE pa.appointment_id = NEW.id AND julianday(pa.occurred_at) >= julianday(period_start) AND julianday(pa.occurred_at) < julianday(period_end))
    );
END;
CREATE TRIGGER employee_payroll_invalidate AFTER UPDATE OF fixed_salary, revenue_percent, is_active ON employees
WHEN NEW.fixed_salary IS NOT OLD.fixed_salary OR NEW.revenue_percent IS NOT OLD.revenue_percent OR NEW.is_active IS NOT OLD.is_active
BEGIN UPDATE payroll_periods SET status = 'DRAFT', updated_at = CURRENT_TIMESTAMP WHERE status <> 'CLOSED'; END;
CREATE TRIGGER employee_payroll_insert AFTER INSERT ON employees
WHEN NEW.is_active = 1
BEGIN UPDATE payroll_periods SET status = 'DRAFT', updated_at = CURRENT_TIMESTAMP WHERE status <> 'CLOSED'; END;
CREATE TRIGGER payroll_adjustments_invalidate_update AFTER UPDATE ON payroll_adjustments
BEGIN UPDATE payroll_periods SET status = 'DRAFT', updated_at = CURRENT_TIMESTAMP WHERE id IN (OLD.period_id, NEW.period_id) AND status <> 'CLOSED'; END;
CREATE TRIGGER payroll_adjustments_invalidate_delete AFTER DELETE ON payroll_adjustments
BEGIN UPDATE payroll_periods SET status = 'DRAFT', updated_at = CURRENT_TIMESTAMP WHERE id = OLD.period_id AND status <> 'CLOSED'; END;

-- Financial correction is a new refund/adjustment, never rewriting the original payment.
CREATE TRIGGER payment_append_only_update BEFORE UPDATE ON payments
BEGIN SELECT RAISE(ABORT, 'CRM_LEDGER_IMMUTABLE'); END;
CREATE TRIGGER payment_append_only_delete BEFORE DELETE ON payments
BEGIN SELECT RAISE(ABORT, 'CRM_LEDGER_IMMUTABLE'); END;
CREATE TRIGGER refund_append_only_update BEFORE UPDATE ON payment_adjustments
BEGIN SELECT RAISE(ABORT, 'CRM_LEDGER_IMMUTABLE'); END;
CREATE TRIGGER refund_append_only_delete BEFORE DELETE ON payment_adjustments
BEGIN SELECT RAISE(ABORT, 'CRM_LEDGER_IMMUTABLE'); END;
CREATE TRIGGER posted_ledger_immutable_update BEFORE UPDATE ON financial_transactions
WHEN OLD.status = 'POSTED' AND OLD.kind IN ('PAYMENT', 'REFUND', 'SALARY')
BEGIN SELECT RAISE(ABORT, 'CRM_LEDGER_IMMUTABLE'); END;
CREATE TRIGGER posted_ledger_immutable_delete BEFORE DELETE ON financial_transactions
WHEN OLD.status = 'POSTED' AND OLD.kind IN ('PAYMENT', 'REFUND', 'SALARY')
BEGIN SELECT RAISE(ABORT, 'CRM_LEDGER_IMMUTABLE'); END;
CREATE TRIGGER completed_services_insert BEFORE INSERT ON appointment_services
WHEN EXISTS(SELECT 1 FROM appointments WHERE id = NEW.appointment_id AND status = 'COMPLETED')
BEGIN SELECT RAISE(ABORT, 'CRM_VISIT_CLOSED'); END;
CREATE TRIGGER completed_services_update BEFORE UPDATE ON appointment_services
WHEN EXISTS(SELECT 1 FROM appointments WHERE id IN (OLD.appointment_id, NEW.appointment_id) AND status = 'COMPLETED')
BEGIN SELECT RAISE(ABORT, 'CRM_VISIT_CLOSED'); END;
CREATE TRIGGER completed_services_delete BEFORE DELETE ON appointment_services
WHEN EXISTS(SELECT 1 FROM appointments WHERE id = OLD.appointment_id AND status = 'COMPLETED')
BEGIN SELECT RAISE(ABORT, 'CRM_VISIT_CLOSED'); END;
CREATE TRIGGER completed_visit_delete BEFORE DELETE ON appointments
WHEN OLD.status = 'COMPLETED'
BEGIN SELECT RAISE(ABORT, 'CRM_VISIT_CLOSED'); END;

CREATE UNIQUE INDEX idx_ledger_payment_once ON financial_transactions(payment_id)
WHERE payment_id IS NOT NULL AND kind = 'PAYMENT';
CREATE TRIGGER voided_ledger_terminal BEFORE UPDATE OF status ON financial_transactions
WHEN OLD.status = 'VOIDED' AND NEW.status <> 'VOIDED'
BEGIN SELECT RAISE(ABORT, 'CRM_LEDGER_IMMUTABLE'); END;
CREATE TRIGGER refund_positive_insert BEFORE INSERT ON payment_adjustments
WHEN NEW.amount <= 0 OR abs(NEW.amount * 100 - round(NEW.amount * 100)) > 0.00001
BEGIN SELECT RAISE(ABORT, 'CRM_INVALID_MONEY'); END;

-- Prior calculated periods may have missed late completion/payment invalidation.
-- Require a fresh calculation; closed snapshots are intentionally untouched.
UPDATE payroll_periods SET status = 'DRAFT', updated_at = CURRENT_TIMESTAMP WHERE status = 'CALCULATED';
