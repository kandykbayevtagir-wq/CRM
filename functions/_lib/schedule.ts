import { localDate } from "../../src/lib/appointments/schedule";

export async function scheduleConflict(db: D1Database, employeeId: string, branchId: string, startsAt: string, endsAt: string) {
  const settings = await db.prepare("SELECT timezone, working_days AS workingDays, booking_start_time AS startTime, booking_end_time AS endTime FROM organization_settings WHERE id = 1").first<{ timezone: string; workingDays: string; startTime: string; endTime: string }>();
  const timezone = settings?.timezone || "Asia/Almaty";
  const date = localDate(startsAt, timezone);
  if (localDate(endsAt, timezone) !== date) return "Приём должен завершиться в тот же рабочий день";
  const day = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
  if (!(settings?.workingDays || "1,2,3,4,5,6").split(",").map(Number).includes(day)) return "Центр не работает в выбранный день";
  const shift = await db.prepare("SELECT starts_time AS startTime, ends_time AS endTime, break_start_time AS breakStart, break_end_time AS breakEnd FROM employee_schedules WHERE employee_id = ? AND day_of_week = ? AND is_active = 1").bind(employeeId, day).first<{ startTime: string; endTime: string; breakStart: string | null; breakEnd: string | null }>();
  if (!shift) return "У специалиста нет рабочей смены в этот день";
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const start = formatter.format(new Date(startsAt));
  const end = formatter.format(new Date(endsAt));
  if (start < shift.startTime || end > shift.endTime || start < (settings?.startTime || "00:00") || end > (settings?.endTime || "23:59")) return "Время выходит за пределы рабочей смены";
  if (shift.breakStart && shift.breakEnd && start < shift.breakEnd && end > shift.breakStart) return "В это время у специалиста перерыв";
  const absence = await db.prepare("SELECT id FROM employee_time_off WHERE employee_id = ? AND julianday(starts_at) < julianday(?) AND julianday(ends_at) > julianday(?) LIMIT 1").bind(employeeId, endsAt, startsAt).first();
  if (absence) return "Специалист недоступен в это время";
  const closure = await db.prepare("SELECT id FROM branch_closures WHERE (branch_id = ? OR branch_id IS NULL) AND julianday(starts_at) < julianday(?) AND julianday(ends_at) > julianday(?) LIMIT 1").bind(branchId, endsAt, startsAt).first();
  return closure ? "Филиал закрыт в выбранное время" : null;
}
