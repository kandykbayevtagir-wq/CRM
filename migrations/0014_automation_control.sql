-- Additive automation/recovery release. No business records are removed.
ALTER TABLE campaigns ADD COLUMN preparation_cursor TEXT NOT NULL DEFAULT '';
ALTER TABLE campaigns ADD COLUMN preparation_complete INTEGER NOT NULL DEFAULT 1;
ALTER TABLE campaigns ADD COLUMN started_at TEXT;
CREATE INDEX idx_campaign_schedule ON campaigns(status, scheduled_at);
ALTER TABLE booking_holds ADD COLUMN ends_at TEXT;
ALTER TABLE booking_holds ADD COLUMN service_id TEXT REFERENCES services(id);
ALTER TABLE booking_holds ADD COLUMN waitlist_id TEXT REFERENCES client_waitlist(id);
ALTER TABLE booking_holds ADD COLUMN appointment_id TEXT REFERENCES appointments(id);
UPDATE booking_holds SET ends_at = datetime(starts_at, '+60 minutes') WHERE ends_at IS NULL;
DROP INDEX idx_booking_holds_active_slot;
CREATE INDEX idx_holds_interval ON booking_holds(employee_id, status, starts_at, ends_at, expires_at);
CREATE UNIQUE INDEX idx_hold_waitlist ON booking_holds(waitlist_id) WHERE status = 'HELD';
ALTER TABLE client_waitlist ADD COLUMN appointment_id TEXT REFERENCES appointments(id);
ALTER TABLE client_waitlist ADD COLUMN retry_after TEXT;
ALTER TABLE client_waitlist ADD COLUMN offer_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE client_waitlist ADD COLUMN scan_offset INTEGER NOT NULL DEFAULT 0;
ALTER TABLE organization_settings ADD COLUMN daily_summary_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE organization_settings ADD COLUMN daily_summary_hour INTEGER NOT NULL DEFAULT 9;
CREATE TABLE telegram_delivery_throttle (
  telegram_id TEXT PRIMARY KEY,
  attempted_at TEXT NOT NULL
);
CREATE TRIGGER hold_valid_insert BEFORE INSERT ON booking_holds
WHEN NEW.status='HELD' AND (NEW.ends_at IS NULL OR julianday(NEW.ends_at) <= julianday(NEW.starts_at)
    OR julianday(NEW.expires_at) <= julianday('now'))
BEGIN SELECT RAISE(ABORT, 'CRM_INVALID_HOLD'); END;
CREATE TRIGGER hold_interval_insert BEFORE INSERT ON booking_holds
WHEN NEW.status='HELD' AND (EXISTS(SELECT 1 FROM appointments a WHERE a.employee_id = NEW.employee_id
    AND a.status NOT IN ('CANCELLED','NO_SHOW') AND julianday(a.starts_at) < julianday(NEW.ends_at)
    AND julianday(COALESCE(a.ends_at, datetime(a.starts_at,'+60 minutes'))) > julianday(NEW.starts_at))
    OR EXISTS(SELECT 1 FROM booking_holds h WHERE h.employee_id = NEW.employee_id AND h.status = 'HELD'
      AND julianday(h.expires_at) > julianday('now') AND julianday(h.starts_at) < julianday(NEW.ends_at)
      AND julianday(h.ends_at) > julianday(NEW.starts_at)))
BEGIN SELECT RAISE(ABORT, 'CRM_SLOT_UNAVAILABLE'); END;
CREATE TRIGGER hold_terminal BEFORE UPDATE ON booking_holds
WHEN OLD.status <> 'HELD' AND NEW.status = 'HELD'
BEGIN SELECT RAISE(ABORT, 'CRM_HOLD_CLOSED'); END;
CREATE TRIGGER appointment_hold_insert BEFORE INSERT ON appointments
WHEN NEW.status NOT IN ('CANCELLED','NO_SHOW') AND EXISTS(SELECT 1 FROM booking_holds h
  WHERE h.employee_id = NEW.employee_id AND h.status = 'HELD' AND julianday(h.expires_at) > julianday('now')
    AND julianday(h.starts_at) < julianday(NEW.ends_at) AND julianday(h.ends_at) > julianday(NEW.starts_at))
BEGIN SELECT RAISE(ABORT, 'CRM_SLOT_UNAVAILABLE'); END;
CREATE TRIGGER appointment_hold_update BEFORE UPDATE OF starts_at, ends_at, employee_id, status ON appointments
WHEN NEW.status NOT IN ('CANCELLED','NO_SHOW') AND
  (NEW.starts_at IS NOT OLD.starts_at OR NEW.ends_at IS NOT OLD.ends_at OR NEW.employee_id IS NOT OLD.employee_id
    OR OLD.status IN ('CANCELLED','NO_SHOW')) AND EXISTS(SELECT 1 FROM booking_holds h
      WHERE h.employee_id = NEW.employee_id AND h.status = 'HELD' AND julianday(h.expires_at) > julianday('now')
        AND julianday(h.starts_at) < julianday(NEW.ends_at) AND julianday(h.ends_at) > julianday(NEW.starts_at))
BEGIN SELECT RAISE(ABORT, 'CRM_SLOT_UNAVAILABLE'); END;
INSERT OR IGNORE INTO notification_templates(id,template_key,name,body) VALUES
 ('template-waitlist','WAITLIST_OFFER','Окно из листа ожидания','{clientName}, появилось свободное время: {date} в {time}. {service}, {specialist}, {branch}. Откройте предложение и подтвердите до истечения срока.'),
 ('template-follow-up-due','FOLLOW_UP_DUE','Повторный визит по сроку','{clientName}, подошёл рекомендованный специалистом срок повторного визита. Выберите удобное время в личном кабинете.');
