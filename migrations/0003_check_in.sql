ALTER TABLE appointments ADD COLUMN check_in_token TEXT;
ALTER TABLE appointments ADD COLUMN checked_in_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_check_in_token
  ON appointments(check_in_token) WHERE check_in_token IS NOT NULL;
