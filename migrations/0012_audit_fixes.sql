-- Audit release: triggers and templates only. No rows are rewritten or removed.

-- The overlap guard on UPDATE used to fire on every status change, so two appointments that
-- already overlapped before 0011 (legacy data) could never be confirmed, started or completed,
-- and the Telegram webhook failed with 500 on such rows. The check now runs only when the time,
-- the specialist or the activity of the row actually changes.
DROP TRIGGER IF EXISTS appointment_overlap_update;
CREATE TRIGGER appointment_overlap_update BEFORE UPDATE OF starts_at, ends_at, employee_id, status ON appointments
WHEN NEW.status NOT IN ('CANCELLED', 'NO_SHOW')
  AND (
    NEW.starts_at IS NOT OLD.starts_at
    OR NEW.ends_at IS NOT OLD.ends_at
    OR NEW.employee_id IS NOT OLD.employee_id
    OR OLD.status IN ('CANCELLED', 'NO_SHOW')
  )
  AND EXISTS (
    SELECT 1 FROM appointments a WHERE a.id <> NEW.id AND a.employee_id = NEW.employee_id
      AND a.status NOT IN ('CANCELLED', 'NO_SHOW')
      AND julianday(a.starts_at) < julianday(COALESCE(NEW.ends_at, datetime(NEW.starts_at, '+60 minutes')))
      AND julianday(COALESCE(a.ends_at, datetime(a.starts_at, '+60 minutes'))) > julianday(NEW.starts_at)
  )
BEGIN SELECT RAISE(ABORT, 'CRM_SLOT_UNAVAILABLE'); END;

-- 0009 tried to replace this template with INSERT OR IGNORE, which never overwrites an existing row,
-- so the cancellation reason ({message}) was never delivered to clients.
UPDATE notification_templates
SET body = '❌ Запись {date} в {time} отменена. {message} Если захотите, выберите новое время в Mini App.', updated_at = CURRENT_TIMESTAMP
WHERE template_key = 'BOOKING_CANCELLED';
