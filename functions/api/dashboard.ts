import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { json } from "../_lib/http";
import { calculateAvailableWorkingMinutes } from "../_lib/working-time";

type CountRow = { value: number | string | null };

function monthRange(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    key: `${year}-${String(month + 1).padStart(2, "0")}`,
    from: new Date(Date.UTC(year, month, 1)).toISOString(),
    to: new Date(Date.UTC(year, month + 1, 1)).toISOString(),
  };
}

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "dashboard.read")) return forbidden();
  const settings = await env.DB.prepare("SELECT timezone FROM organization_settings WHERE id = 1").first<{ timezone: string }>();
  const { key, from, to } = monthRange();
  const branchId = new URL(request.url).searchParams.get("branchId")?.trim() ?? "";
  const ownEmployee = user.role === "SPECIALIST"
    ? await env.DB.prepare("SELECT id FROM employees WHERE user_id = ? AND is_active = 1 LIMIT 1").bind(user.id).first<{ id: string }>()
    : null;
  const employeeScope = ownEmployee ? " AND a.employee_id = ?" : "";
  const employeeBinding = ownEmployee ? [ownEmployee.id] : [];
  const branchScope = branchId ? " AND a.branch_id = ?" : "";
  const branchBinding = branchId ? [branchId] : [];
  const [clients, todayAppointments, monthAppointments, revenue, refunds, expenses, payroll, newClients, noShows, occupied, upcoming, activeEmployees, revenueByDay, refundsByDay, schedules, timeOff] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS value FROM clients WHERE is_active = 1").first<CountRow>(),
    env.DB.prepare(`SELECT COUNT(*) AS value FROM appointments a WHERE date(a.starts_at, 'localtime') = date('now', 'localtime') AND a.status NOT IN ('CANCELLED', 'NO_SHOW')${employeeScope}${branchScope}`).bind(...employeeBinding, ...branchBinding).first<CountRow>(),
    env.DB.prepare(`SELECT COUNT(*) AS value FROM appointments a WHERE strftime('%Y-%m', a.starts_at, 'localtime') = ? AND a.status NOT IN ('CANCELLED', 'NO_SHOW')${employeeScope}${branchScope}`).bind(key, ...employeeBinding, ...branchBinding).first<CountRow>(),
    env.DB.prepare(`SELECT COALESCE(SUM(p.amount), 0) AS value FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id WHERE a.status = 'COMPLETED' AND p.payment_status = 'POSTED' AND strftime('%Y-%m', p.paid_at, 'localtime') = ?${employeeScope}${branchScope}`).bind(key, ...employeeBinding, ...branchBinding).first<CountRow>(),
    env.DB.prepare(`SELECT COALESCE(SUM(pa.amount), 0) AS value FROM payment_adjustments pa INNER JOIN payments p ON p.id = pa.payment_id INNER JOIN appointments a ON a.id = p.appointment_id WHERE a.status = 'COMPLETED' AND strftime('%Y-%m', pa.occurred_at, 'localtime') = ?${employeeScope}${branchScope}`).bind(key, ...employeeBinding, ...branchBinding).first<CountRow>(),
    env.DB.prepare(`SELECT COALESCE(SUM(amount), 0) AS value FROM financial_transactions WHERE direction = 'EXPENSE' AND kind <> 'SALARY' AND status = 'POSTED' AND strftime('%Y-%m', occurred_at, 'localtime') = ?${branchId ? " AND branch_id = ?" : ""}`).bind(key, ...branchBinding).first<CountRow>(),
    env.DB.prepare("SELECT COALESCE(SUM(total_amount), 0) AS value FROM payroll_periods WHERE status IN ('CALCULATED', 'CLOSED') AND strftime('%Y-%m', period_start, 'localtime') = ?").bind(key).first<CountRow>(),
    env.DB.prepare("SELECT COUNT(*) AS value FROM clients WHERE is_active = 1 AND strftime('%Y-%m', created_at, 'localtime') = ?").bind(key).first<CountRow>(),
    env.DB.prepare(`SELECT COUNT(*) AS value FROM appointments a WHERE strftime('%Y-%m', a.starts_at, 'localtime') = ? AND a.status = 'NO_SHOW'${employeeScope}${branchScope}`).bind(key, ...employeeBinding, ...branchBinding).first<CountRow>(),
    env.DB.prepare(`SELECT COALESCE(SUM(MAX((julianday(a.ends_at) - julianday(a.starts_at)) * 1440, 0)), 0) AS value FROM appointments a WHERE strftime('%Y-%m', a.starts_at, 'localtime') = ? AND a.status NOT IN ('CANCELLED', 'NO_SHOW') AND a.ends_at IS NOT NULL${employeeScope}${branchScope}`).bind(key, ...employeeBinding, ...branchBinding).first<CountRow>(),
    env.DB.prepare(`
      SELECT a.id, a.starts_at AS startsAt, a.ends_at AS endsAt, a.status, a.total_amount AS amount,
        c.full_name AS clientName, c.phone AS clientPhone, e.full_name AS employeeName, b.name AS branchName,
        (SELECT group_concat(s.name, ', ') FROM appointment_services aps INNER JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id) AS serviceName,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.appointment_id = a.id AND p.payment_status = 'POSTED'), 0) AS paidAmount
      FROM appointments a INNER JOIN clients c ON c.id = a.client_id LEFT JOIN employees e ON e.id = a.employee_id LEFT JOIN branches b ON b.id = a.branch_id
      WHERE a.starts_at >= CURRENT_TIMESTAMP AND a.status IN ('SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_PROGRESS')${employeeScope}${branchScope}
      ORDER BY a.starts_at ASC LIMIT 6
    `).bind(...employeeBinding, ...branchBinding).all(),
    env.DB.prepare(`SELECT COUNT(*) AS value FROM employees e WHERE e.is_active = 1${branchId ? " AND EXISTS (SELECT 1 FROM employee_branches eb WHERE eb.employee_id = e.id AND eb.branch_id = ?)" : ""}`).bind(...branchBinding).first<CountRow>(),
    env.DB.prepare(`SELECT date(p.paid_at, 'localtime') AS day, COALESCE(SUM(p.amount), 0) AS amount FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id WHERE a.status = 'COMPLETED' AND p.payment_status = 'POSTED' AND p.paid_at >= datetime('now', 'localtime', '-6 days')${employeeScope}${branchScope} GROUP BY date(p.paid_at, 'localtime') ORDER BY day ASC`).bind(...employeeBinding, ...branchBinding).all<{ day: string; amount: number }>(),
    env.DB.prepare(`SELECT date(pa.occurred_at, 'localtime') AS day, COALESCE(SUM(pa.amount), 0) AS amount FROM payment_adjustments pa INNER JOIN payments p ON p.id = pa.payment_id INNER JOIN appointments a ON a.id = p.appointment_id WHERE a.status = 'COMPLETED' AND pa.occurred_at >= datetime('now', 'localtime', '-6 days')${employeeScope}${branchScope} GROUP BY date(pa.occurred_at, 'localtime') ORDER BY day ASC`).bind(...employeeBinding, ...branchBinding).all<{ day: string; amount: number }>(),
    env.DB.prepare(`SELECT employee_id AS employeeId, day_of_week AS dayOfWeek, starts_time AS startsTime, ends_time AS endsTime, break_start_time AS breakStartTime, break_end_time AS breakEndTime FROM employee_schedules WHERE is_active = 1${branchId ? " AND EXISTS (SELECT 1 FROM employee_branches eb WHERE eb.employee_id = employee_schedules.employee_id AND eb.branch_id = ?)" : ""}`).bind(...branchBinding).all<{ employeeId: string; dayOfWeek: number; startsTime: string; endsTime: string; breakStartTime: string | null; breakEndTime: string | null }>(),
    env.DB.prepare(`SELECT employee_id AS employeeId, starts_at AS startsAt, ends_at AS endsAt FROM employee_time_off WHERE ends_at >= ? AND starts_at < ?${branchId ? " AND EXISTS (SELECT 1 FROM employee_branches eb WHERE eb.employee_id = employee_time_off.employee_id AND eb.branch_id = ?)" : ""}`).bind(from, to, ...branchBinding).all<{ employeeId: string; startsAt: string; endsAt: string }>(),
  ]);

  const grossRevenue = Number(revenue?.value ?? 0);
  const refundAmount = Number(refunds?.value ?? 0);
  const netRevenue = grossRevenue - refundAmount;
  const availableWorkingMinutes = calculateAvailableWorkingMinutes(schedules.results ?? [], timeOff.results ?? [], new Date(from), new Date(to), settings?.timezone ?? "Asia/Almaty");
  const occupiedMinutes = Math.max(0, Math.round(Number(occupied?.value ?? 0)));
  const completedAppointments = await env.DB.prepare(`SELECT COUNT(*) AS value FROM appointments a WHERE strftime('%Y-%m', a.starts_at, 'localtime') = ? AND a.status = 'COMPLETED'${employeeScope}${branchScope}`).bind(key, ...employeeBinding, ...branchBinding).first<CountRow>();
  const revenueDays = new Map<string, number>();
  for (const row of revenueByDay.results ?? []) revenueDays.set(row.day, Number(row.amount ?? 0));
  for (const row of refundsByDay.results ?? []) revenueDays.set(row.day, (revenueDays.get(row.day) ?? 0) - Number(row.amount ?? 0));
  return json({
    ok: true,
    metrics: {
      clients: Number(clients?.value ?? 0),
      todayAppointments: Number(todayAppointments?.value ?? 0),
      monthAppointments: Number(monthAppointments?.value ?? 0),
      revenue: netRevenue,
      grossRevenue,
      refunds: refundAmount,
      expenses: Number(expenses?.value ?? 0),
      payroll: Number(payroll?.value ?? 0),
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
