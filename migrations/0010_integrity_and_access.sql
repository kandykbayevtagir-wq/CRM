-- Additive migration: existing financial records are preserved.
CREATE TABLE auth_rate_limits (
  key TEXT PRIMARY KEY, bucket INTEGER NOT NULL, attempts INTEGER NOT NULL
);
CREATE INDEX idx_auth_rate_limits_bucket ON auth_rate_limits(bucket);

-- Ephemeral transaction assertions. The paired DELETE is in the same batch.
CREATE TABLE mutation_guards (
  id TEXT PRIMARY KEY,
  passed INTEGER NOT NULL CONSTRAINT mutation_precondition CHECK(passed = 1)
);

ALTER TABLE appointments ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER appointments_revision AFTER UPDATE ON appointments
WHEN NEW.revision = OLD.revision
BEGIN UPDATE appointments SET revision = OLD.revision + 1 WHERE id = OLD.id; END;

ALTER TABLE payroll_periods ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER payroll_periods_revision AFTER UPDATE ON payroll_periods
WHEN NEW.revision = OLD.revision AND NEW.status <> 'CLOSED'
BEGIN UPDATE payroll_periods SET revision = OLD.revision + 1 WHERE id = OLD.id; END;

CREATE TRIGGER payroll_periods_closed_update BEFORE UPDATE ON payroll_periods
WHEN OLD.status = 'CLOSED'
BEGIN SELECT RAISE(ABORT, 'CRM_PAYROLL_CLOSED'); END;
CREATE TRIGGER payroll_periods_closed_delete BEFORE DELETE ON payroll_periods
WHEN OLD.status = 'CLOSED'
BEGIN SELECT RAISE(ABORT, 'CRM_PAYROLL_CLOSED'); END;

CREATE TRIGGER payroll_lines_closed_insert BEFORE INSERT ON payroll_lines
WHEN EXISTS(SELECT 1 FROM payroll_periods WHERE id = NEW.period_id AND status = 'CLOSED')
BEGIN SELECT RAISE(ABORT, 'CRM_PAYROLL_CLOSED'); END;
CREATE TRIGGER payroll_lines_closed_update BEFORE UPDATE ON payroll_lines
WHEN EXISTS(SELECT 1 FROM payroll_periods WHERE id IN (OLD.period_id, NEW.period_id) AND status = 'CLOSED')
BEGIN SELECT RAISE(ABORT, 'CRM_PAYROLL_CLOSED'); END;
CREATE TRIGGER payroll_lines_closed_delete BEFORE DELETE ON payroll_lines
WHEN EXISTS(SELECT 1 FROM payroll_periods WHERE id = OLD.period_id AND status = 'CLOSED')
BEGIN SELECT RAISE(ABORT, 'CRM_PAYROLL_CLOSED'); END;

CREATE TRIGGER payroll_adjustments_closed_insert BEFORE INSERT ON payroll_adjustments
WHEN EXISTS(SELECT 1 FROM payroll_periods WHERE id = NEW.period_id AND status = 'CLOSED')
BEGIN SELECT RAISE(ABORT, 'CRM_PAYROLL_CLOSED'); END;
CREATE TRIGGER payroll_adjustments_closed_update BEFORE UPDATE ON payroll_adjustments
WHEN EXISTS(SELECT 1 FROM payroll_periods WHERE id IN (OLD.period_id, NEW.period_id) AND status = 'CLOSED')
BEGIN SELECT RAISE(ABORT, 'CRM_PAYROLL_CLOSED'); END;
CREATE TRIGGER payroll_adjustments_closed_delete BEFORE DELETE ON payroll_adjustments
WHEN EXISTS(SELECT 1 FROM payroll_periods WHERE id = OLD.period_id AND status = 'CLOSED')
BEGIN SELECT RAISE(ABORT, 'CRM_PAYROLL_CLOSED'); END;
CREATE TRIGGER payroll_adjustments_invalidate AFTER INSERT ON payroll_adjustments
BEGIN UPDATE payroll_periods SET status = 'DRAFT', updated_at = CURRENT_TIMESTAMP WHERE id = NEW.period_id; END;

CREATE TRIGGER stock_nonnegative BEFORE INSERT ON stock_movements
WHEN NEW.direction = 'OUT' AND NEW.quantity > COALESCE((SELECT SUM(CASE WHEN direction = 'IN' THEN quantity ELSE -quantity END) FROM stock_movements WHERE product_id = NEW.product_id AND branch_id = NEW.branch_id), 0) + 0.000001
BEGIN SELECT RAISE(ABORT, 'CRM_INSUFFICIENT_STOCK'); END;
CREATE TRIGGER stock_append_only_update BEFORE UPDATE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'CRM_STOCK_APPEND_ONLY'); END;
CREATE TRIGGER stock_append_only_delete BEFORE DELETE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'CRM_STOCK_APPEND_ONLY'); END;
