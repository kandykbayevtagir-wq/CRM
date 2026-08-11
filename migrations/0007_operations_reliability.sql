PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS employee_services (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  branch_id TEXT REFERENCES branches(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1,
  duration_override_minutes INTEGER,
  price_override REAL,
  commission_percent REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_services_scope
  ON employee_services(employee_id, service_id, COALESCE(branch_id, ''));
CREATE INDEX IF NOT EXISTS idx_employee_services_service
  ON employee_services(service_id, branch_id, active);

INSERT OR IGNORE INTO employee_services (id, employee_id, service_id, active)
SELECT lower(hex(randomblob(16))), e.id, s.id, 1
FROM employees e CROSS JOIN services s
WHERE e.is_active = 1 AND s.is_active = 1;

CREATE TABLE IF NOT EXISTS appointment_slot_reservations (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  slot_start TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (appointment_id, slot_start),
  UNIQUE (employee_id, slot_start)
);

CREATE INDEX IF NOT EXISTS idx_appointment_slot_reservations_appointment
  ON appointment_slot_reservations(appointment_id);
CREATE INDEX IF NOT EXISTS idx_appointment_slot_reservations_employee_range
  ON appointment_slot_reservations(employee_id, slot_start);

WITH RECURSIVE appointment_ranges AS (
  SELECT a.id AS appointment_id, a.employee_id AS employee_id,
    strftime('%Y-%m-%dT%H:%M:%fZ', (CAST(strftime('%s', a.starts_at) AS INTEGER) / 900) * 900, 'unixepoch') AS slot_start,
    COALESCE(a.ends_at, datetime(a.starts_at, '+60 minutes')) AS slot_end
  FROM appointments a
  WHERE a.employee_id IS NOT NULL AND a.status NOT IN ('CANCELLED', 'NO_SHOW')
), expanded AS (
  SELECT appointment_id, employee_id, slot_start, slot_end FROM appointment_ranges
  UNION ALL
  SELECT appointment_id, employee_id,
    strftime('%Y-%m-%dT%H:%M:%fZ', (CAST(strftime('%s', slot_start) AS INTEGER) + 900), 'unixepoch'),
    slot_end
  FROM expanded
  WHERE datetime(slot_start, '+15 minutes') < datetime(slot_end)
)
INSERT OR IGNORE INTO appointment_slot_reservations (id, appointment_id, employee_id, slot_start)
SELECT lower(hex(randomblob(16))), appointment_id, employee_id, slot_start FROM expanded;

CREATE TABLE IF NOT EXISTS booking_idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  changed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_booking_idempotency_user_created
  ON booking_idempotency_keys(user_id, created_at);

PRAGMA foreign_keys = ON;
