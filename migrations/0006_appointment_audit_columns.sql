ALTER TABLE appointments ADD COLUMN created_by TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_created_by ON appointments(created_by);
