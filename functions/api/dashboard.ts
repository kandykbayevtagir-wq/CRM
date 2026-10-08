import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import { inRange, isoColumn, localDayExpression, localMonthRange, localTodayRange, organizationTimezone } from "../_lib/dates";
import type { CrmEnv } from "../_lib/env";
import { json } from "../_lib/http";
import { calculateAvailableWorkingMinutes } from "../_lib/working-time";
import { localDayRange, localDate } from "../../src/lib/appointments/schedule";

type CountRow = { value: number | string | null };

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "dashboard.read")) return forbidden();
  const settings = await env.DB.prepare("SELECT timezone, booking_start_time AS startTime, booking_end_time AS endTime, working_days AS workingDays FROM organization_settings WHERE id = 1").first<{ timezone: string; startTime: string; endTime: string; workingDays: string }>();
  const timezone = settings?.timezone || await organizationTimezone(env.DB);
  const month = localMonthRange(timezone);
  const today = localTodayRange(timezone);
  const weekStart = localDayRange(new Date(Date.parse(`${localDate(new Date(), timezone)}T12:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10), timezone).from;
  // Financial totals are visible only to roles that may read finance / payroll.
  const canSeeFinance = hasCrmPermission(user, "finance.read");
  const canSeePayroll = hasCrmPermission(user, "payroll.read");
  const branchId = new URL(request.url).searchParams.get("branchId")?.trim() ?? "";
  const ownEmployee = user.role === "SPECIALIST"
    ? await env.DB.prepare("SELECT id FROM employees WHERE user_id = ? AND is_active = 1 LIMIT 1").bind(user.id).first<{ id: string }>()
    : null;
  const employeeScope = ownEmployee ? " AND a.employee_id = ?" : "";
  const employeeBinding = ownEmployee ? [ownEmployee.id] : [];
  const branchScope = branchId ? " AND a.branch_id = ?" : "";
  const branchBinding = branchId ? [branchId] : [];
  const monthScope = (column: string) => `${inRange(column)}${employeeScope}${branchScope}`;
  const monthBindings = [month.from, month.to, ...employeeBinding, ...branchBinding];
  const [clients, todayAppointments, monthAppointments, revenue, refunds, expenses, payroll, newClients, noShows, occupied, upcoming, activeEmployees, revenueByDay, refundsByDay, schedules, timeOff, completedAppointments] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS value FROM clients WHERE is_active = 1").first<CountRow>(),
    env.DB.prepare(`SELECT COUNT(*) AS value FROM appointments a WHERE ${inRange("a.starts_at")} AND a.status NOT IN ('CANCELLED', 'NO_SHOW')${employeeScope}${branchScope}`).bind(today.from, today.to, ...employeeBinding, ...branchBinding).first<CountRow>(),
    env.DB.prepare(`SELECT COUNT(*) AS value FROM appointments a WHERE ${monthScope("a.starts_at")} AND a.status NOT IN ('CANCELLED', 'NO_SHOW')`).bind(...monthBindings).first<CountRow>(),
    env.DB.prepare(`SELECT COALESCE(SUM(p.amount), 0) AS value FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id WHERE a.status = 'COMPLETED' AND p.payment_status = 'POSTED' AND ${monthScope("p.paid_at")}`).bind(...monthBindings).first<CountRow>(),
    env.DB.prepare(`SELECT COALESCE(SUM(pa.amount), 0) AS value FROM payment_adjustments pa INNER JOIN payments p ON p.id = pa.payment_id INNER JOIN appointments a ON a.id = p.appointment_id WHERE a.status = 'COMPLETED' AND ${monthScope("pa.occurred_at")}`).bind(...monthBindings).first<CountRow>(),
    canSeeFinance ? env.DB.prepare(`SELECT COALESCE(SUM(amount), 0) AS value FROM financial_transactions WHERE direction = 'EXPENSE' AND kind <> 'SALARY' AND status = 'POSTED' AND ${inRange("occurred_at")}${branchId ? " AND branch_id = ?" : ""}`).bind(month.from, month.to, ...branchBinding).first<CountRow>() : Promise.resolve(null),
    canSeePayroll ? env.DB.prepare(`SELECT COALESCE(SUM(total_amount), 0) AS value FROM payroll_periods WHERE status IN ('CALCULATED', 'CLOSED') AND ${inRange("period_start")}`).bind(month.from, month.to).first<CountRow>() : Promise.resolve(null),
    env.DB.prepare(`SELECT COUNT(*) AS value FROM clients WHERE is_active = 1 AND ${inRange("created_at")}`).bind(month.from, month.to).first<CountRow>(),
    env.DB.prepare(`SELECT COUNT(*) AS value FROM appointments a WHERE ${monthScope("a.starts_at")} AND a.status = 'NO_SHOW'`).bind(...monthBindings).first<CountRow>(),
    env.DB.prepare(`SELECT COALESCE(SUM(MAX((julianday(a.ends_at) - julianday(a.starts_at)) * 1440, 0)), 0) AS value FROM appointments a WHERE ${monthScope("a.starts_at")} AND a.status NOT IN ('CANCELLED', 'NO_SHOW') AND a.ends_at IS NOT NULL`).bind(...monthBindings).first<CountRow>(),
    env.DB.prepare(`
      SELECT a.id, ${isoColumn("a.starts_at")} AS startsAt, ${isoColumn("a.ends_at")} AS endsAt, a.status, a.total_amount AS amount,
        c.full_name AS clientName, c.phone AS clientPhone, e.full_name AS employeeName, b.name AS branchName,
        (SELECT group_concat(s.name, ', ') FROM appointment_services aps INNER JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id) AS serviceName,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.appointment_id = a.id AND p.payment_status = 'POSTED'), 0) AS paidAmount
      FROM appointments a INNER JOIN clients c ON c.id = a.client_id LEFT JOIN employees e ON e.id = a.employee_id LEFT JOIN branches b ON b.id = a.branch_id
      WHERE julianday(a.starts_at) >= julianday('now') AND a.status IN ('SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_PROGRESS')${employeeScope}${branchScope}
      ORDER BY julianday(a.starts_at) ASC LIMIT 6
    `).bind(...employeeBinding, ...branchBinding).all(),
    env.DB.prepare(`SELECT COUNT(*) AS value FROM employees e WHERE e.is_active = 1${branchId ? " AND EXISTS (SELECT 1 FROM employee_branches eb WHERE eb.employee_id = e.id AND eb.branch_id = ?)" : ""}`).bind(...branchBinding).first<CountRow>(),
    env.DB.prepare(`SELECT ${localDayExpression("p.paid_at", weekStart, timezone)} AS day, COALESCE(SUM(p.amount), 0) AS amount FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id WHERE a.status = 'COMPLETED' AND p.payment_status = 'POSTED' AND julianday(p.paid_at) >= julianday(?)${employeeScope}${branchScope} GROUP BY day ORDER BY day ASC`).bind(weekStart, ...employeeBinding, ...branchBinding).all<{ day: string; amount: number }>(),
    env.DB.prepare(`SELECT ${localDayExpression("pa.occurred_at", weekStart, timezone)} AS day, COALESCE(SUM(pa.amount), 0) AS amount FROM payment_adjustments pa INNER JOIN payments p ON p.id = pa.payment_id INNER JOIN appointments a ON a.id = p.appointment_id WHERE a.status = 'COMPLETED' AND julianday(pa.occurred_at) >= julianday(?)${employeeScope}${branchScope} GROUP BY day ORDER BY day ASC`).bind(weekStart, ...employeeBinding, ...branchBinding).all<{ day: string; amount: number }>(),
    env.DB.prepare(`SELECT employee_id AS employeeId, day_of_week AS dayOfWeek, starts_time AS startsTime, ends_time AS endsTime, break_start_time AS breakStartTime, break_end_time AS breakEndTime FROM employee_schedules WHERE is_active = 1${branchId ? " AND EXISTS (SELECT 1 FROM employee_branches eb WHERE eb.employee_id = employee_schedules.employee_id AND eb.branch_id = ?)" : ""}`).bind(...branchBinding).all<{ employeeId: string; dayOfWeek: number; startsTime: string; endsTime: string; breakStartTime: string | null; breakEndTime: string | null }>(),
    env.DB.prepare(`SELECT employee_id AS employeeId, starts_at AS startsAt, ends_at AS endsAt FROM employee_time_off WHERE julianday(ends_at) >= julianday(?) AND julianday(starts_at) < julianday(?)${branchId ? " AND EXISTS (SELECT 1 FROM employee_branches eb WHERE eb.employee_id = employee_time_off.employee_id AND eb.branch_id = ?)" : ""}`).bind(month.from, month.to, ...branchBinding).all<{ employeeId: string; startsAt: string; endsAt: string }>(),
    env.DB.prepare(`SELECT COUNT(*) AS value FROM appointments a WHERE ${monthScope("a.starts_at")} AND a.status = 'COMPLETED'`).bind(...monthBindings).first<CountRow>(),
  ]);

  const grossRevenue = Number(revenue?.value ?? 0);
  const refundAmount = Number(refunds?.value ?? 0);
  const netRevenue = grossRevenue - refundAmount;
  const availableWorkingMinutes = calculateAvailableWorkingMinutes(schedules.results ?? [], timeOff.results ?? [], new Date(month.from), new Date(month.to), timezone, settings ?? {});
  const occupiedMinutes = Math.max(0, Math.round(Number(occupied?.value ?? 0)));
  const revenueDays = new Map<string, number>();
  for (const row of revenueByDay.results ?? []) revenueDays.set(row.day, Number(row.amount ?? 0));
  for (const row of refundsByDay.results ?? []) revenueDays.set(row.day, (revenueDays.get(row.day) ?? 0) - Number(row.amount ?? 0));
  return json({
    ok: true,
    period: { from: month.from, to: month.to, timezone },
    metrics: {
      clients: Number(clients?.value ?? 0),
      todayAppointments: Number(todayAppointments?.value ?? 0),
      monthAppointments: Number(monthAppointments?.value ?? 0),
      revenue: netRevenue,
      grossRevenue,
      refunds: refundAmount,
      expenses: canSeeFinance ? Number(expenses?.value ?? 0) : null,
      payroll: canSeePayroll ? Number(payroll?.value ?? 0) : null,
      newClients: Number(newClients?.value ?? 0),
      noShows: Number(noShows?.value ?? 0),
      averageCheck: completedAppointments?.value ? netRevenue / Math.max(1, Number(completedAppointments.value)) : 0,
      occupiedMinutes,
      availableWorkingMinutes,
      occupancy: availableWorkingMinutes > 0 ? Math.min(100, Math.round((occupiedMinutes / availableWorkingMinutes) * 1000) / 10) : 0,
      activeEmployees: Number(activeEmployees?.value ?? 0),
    },
    upcoming: upcoming.results ?? [],
    revenueByDay: Array.from(revenueDays.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([day, amount]) => ({ day, amount: Math.max(0, amount) })),
  });
};
