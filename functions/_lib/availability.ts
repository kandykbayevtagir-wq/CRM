export type AvailabilitySlot = {
  startsAt: string;
  endsAt: string;
  employeeId: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  serviceId: string;
  price: number;
};

type AvailabilityParams = {
  date: string;
  branchId: string;
  serviceId: string;
  employeeId?: string;
  excludeAppointmentId?: string;
};

type TimeRange = { startsTime: string; endsTime: string; breakStartTime?: string | null; breakEndTime?: string | null };

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : 0;
}

function timezoneOffset(date: string, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(`${date}T12:00:00.000Z`));
    const value = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+05:00";
    if (value === "GMT") return "+00:00";
    const match = value.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
    return match ? `${match[1]}${match[2].padStart(2, "0")}:${match[3] ?? "00"}` : "+05:00";
  } catch {
    return "+05:00";
  }
}

function isoAt(date: string, minutes: number, timezone: string) {
  const hours = Math.floor(minutes / 60).toString().padStart(2, "0");
  const remainder = (minutes % 60).toString().padStart(2, "0");
  return new Date(`${date}T${hours}:${remainder}:00${timezoneOffset(date, timezone)}`).toISOString();
}

function dayOfWeek(date: string) {
  const day = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00.000Z`).getTime());
}

export async function findAvailableSlots(db: D1Database, params: AvailabilityParams): Promise<AvailabilitySlot[]> {
  if (!isValidDate(params.date)) throw new Error("Некорректная дата");
  const settings = await db.prepare(`
    SELECT timezone, booking_start_time AS startTime, booking_end_time AS endTime,
      booking_slot_interval AS slotInterval, working_days AS workingDays
    FROM organization_settings WHERE id = 1
  `).first<{ timezone: string; startTime: string; endTime: string; slotInterval: number; workingDays: string }>();
  const day = dayOfWeek(params.date);
  const workingDays = String(settings?.workingDays ?? "1,2,3,4,5,6").split(",").map(Number);
  if (!workingDays.includes(day)) return [];

  const service = await db.prepare("SELECT id, price, duration_minutes AS durationMinutes FROM services WHERE id = ? AND is_active = 1").bind(params.serviceId).first<{ id: string; price: number; durationMinutes: number }>();
  if (!service) throw new Error("Услуга не найдена");
  const branch = await db.prepare("SELECT id, name FROM branches WHERE id = ? AND is_active = 1").bind(params.branchId).first<{ id: string; name: string }>();
  if (!branch) throw new Error("Филиал не найден");

  const employeeQuery = `
    SELECT e.id, e.full_name AS fullName, b.name AS branchName
    FROM employees e INNER JOIN employee_branches eb ON eb.employee_id = e.id INNER JOIN branches b ON b.id = eb.branch_id
    WHERE e.is_active = 1 AND eb.branch_id = ? ${params.employeeId ? "AND e.id = ?" : ""}
    ORDER BY e.full_name ASC
  `;
  const employees = params.employeeId
    ? await db.prepare(employeeQuery).bind(params.branchId, params.employeeId).all<{ id: string; fullName: string; branchName: string }>()
    : await db.prepare(employeeQuery).bind(params.branchId).all<{ id: string; fullName: string; branchName: string }>();
  if (!employees.results?.length) return [];

  const timezone = String(settings?.timezone ?? "Asia/Almaty");
  const dateStart = new Date(`${params.date}T00:00:00${timezoneOffset(params.date, timezone)}`).toISOString();
  const dateEnd = new Date(`${params.date}T23:59:59.999${timezoneOffset(params.date, timezone)}`).toISOString();
  const employeeIds = employees.results.map((employee) => employee.id);
  const placeholders = employeeIds.map(() => "?").join(",");
  const [appointments, timeOff, schedules, closures] = await Promise.all([
    db.prepare(`
      SELECT a.id, a.employee_id AS employeeId, a.starts_at AS startsAt, a.ends_at AS endsAt,
        COALESCE(SUM(s.duration_minutes * aps.quantity), 60) AS durationMinutes
      FROM appointments a
      LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
      LEFT JOIN services s ON s.id = aps.service_id
      WHERE a.employee_id IN (${placeholders}) AND a.starts_at >= ? AND a.starts_at <= ?
        AND a.status NOT IN ('CANCELLED', 'NO_SHOW') ${params.excludeAppointmentId ? "AND a.id <> ?" : ""}
      GROUP BY a.id
    `).bind(...employeeIds, dateStart, dateEnd, ...(params.excludeAppointmentId ? [params.excludeAppointmentId] : [])).all<{ id: string; employeeId: string; startsAt: string; endsAt: string | null; durationMinutes: number }>(),
    db.prepare(`SELECT employee_id AS employeeId, starts_at AS startsAt, ends_at AS endsAt FROM employee_time_off WHERE employee_id IN (${placeholders}) AND starts_at < ? AND ends_at > ?`).bind(...employeeIds, dateEnd, dateStart).all<{ employeeId: string; startsAt: string; endsAt: string }>(),
    db.prepare(`SELECT employee_id AS employeeId, starts_time AS startsTime, ends_time AS endsTime, break_start_time AS breakStartTime, break_end_time AS breakEndTime FROM employee_schedules WHERE employee_id IN (${placeholders}) AND day_of_week = ? AND is_active = 1`).bind(...employeeIds, day).all<{ employeeId: string; startsTime: string; endsTime: string; breakStartTime: string | null; breakEndTime: string | null }>(),
    db.prepare("SELECT branch_id AS branchId, starts_at AS startsAt, ends_at AS endsAt FROM branch_closures WHERE (branch_id = ? OR branch_id IS NULL) AND starts_at < ? AND ends_at > ?").bind(params.branchId, dateEnd, dateStart).all<{ branchId: string | null; startsAt: string; endsAt: string }>(),
  ]);

  const schedulesByEmployee = new Map<string, TimeRange>();
  for (const schedule of schedules.results ?? []) schedulesByEmployee.set(schedule.employeeId, schedule);
  const appointmentsByEmployee = new Map<string, Array<{ startsAt: string; endsAt: string | null; durationMinutes: number }>>();
  for (const appointment of appointments.results ?? []) {
    const rows = appointmentsByEmployee.get(appointment.employeeId) ?? [];
    rows.push(appointment);
    appointmentsByEmployee.set(appointment.employeeId, rows);
  }
  const timeOffByEmployee = new Map<string, Array<{ startsAt: string; endsAt: string }>>();
  for (const item of timeOff.results ?? []) {
    const rows = timeOffByEmployee.get(item.employeeId) ?? [];
    rows.push(item);
    timeOffByEmployee.set(item.employeeId, rows);
  }
  const now = Date.now();
  const slots: AvailabilitySlot[] = [];
  const defaultRange: TimeRange = { startsTime: String(settings?.startTime ?? "09:00"), endsTime: String(settings?.endTime ?? "18:00"), breakStartTime: null, breakEndTime: null };
  const interval = Math.max(15, Number(settings?.slotInterval ?? 30));
  const duration = Math.max(15, Number(service.durationMinutes ?? 60));

  for (const employee of employees.results ?? []) {
    const range = schedulesByEmployee.get(employee.id) ?? defaultRange;
    const start = timeToMinutes(range.startsTime);
    const end = timeToMinutes(range.endsTime);
    const employeeAppointments = appointmentsByEmployee.get(employee.id) ?? [];
    const employeeTimeOff = timeOffByEmployee.get(employee.id) ?? [];
    for (let minute = start; minute + duration <= end; minute += interval) {
      const startsAt = isoAt(params.date, minute, timezone);
      const endsAt = isoAt(params.date, minute + duration, timezone);
      const startMs = new Date(startsAt).getTime();
      const endMs = new Date(endsAt).getTime();
      if (startMs <= now + 5 * 60_000) continue;
      if ((closures.results ?? []).some((closure) => new Date(closure.startsAt).getTime() < endMs && new Date(closure.endsAt).getTime() > startMs)) continue;
      if (employeeTimeOff.some((item) => new Date(item.startsAt).getTime() < endMs && new Date(item.endsAt).getTime() > startMs)) continue;
      if (range.breakStartTime && range.breakEndTime) {
        const breakStart = isoAt(params.date, timeToMinutes(range.breakStartTime), timezone);
        const breakEnd = isoAt(params.date, timeToMinutes(range.breakEndTime), timezone);
        if (new Date(breakStart).getTime() < endMs && new Date(breakEnd).getTime() > startMs) continue;
      }
      if (employeeAppointments.some((appointment) => {
        const existingStart = new Date(appointment.startsAt).getTime();
        const existingEnd = appointment.endsAt ? new Date(appointment.endsAt).getTime() : existingStart + Number(appointment.durationMinutes || 60) * 60_000;
        return existingStart < endMs && existingEnd > startMs;
      })) continue;
      slots.push({ startsAt, endsAt, employeeId: employee.id, employeeName: employee.fullName, branchId: params.branchId, branchName: employee.branchName, serviceId: service.id, price: Number(service.price || 0) });
    }
  }

  return slots.sort((left, right) => left.startsAt.localeCompare(right.startsAt)).slice(0, 200);
}
