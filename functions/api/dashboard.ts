import { getSessionUser, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { json } from "../_lib/http";

type CountRow = { value: number | null };

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();

  const [clients, todayAppointments, monthAppointments, revenue, expenses, payroll, upcoming, activeEmployees, revenueByDay] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS value FROM clients").first<CountRow>(),
    env.DB.prepare("SELECT COUNT(*) AS value FROM appointments WHERE date(starts_at) = date('now', 'localtime') AND status NOT IN ('CANCELLED', 'NO_SHOW')").first<CountRow>(),
    env.DB.prepare("SELECT COUNT(*) AS value FROM appointments WHERE strftime('%Y-%m', starts_at) = strftime('%Y-%m', 'now', 'localtime') AND status NOT IN ('CANCELLED', 'NO_SHOW')").first<CountRow>(),
    env.DB.prepare("SELECT COALESCE(SUM(total_amount), 0) AS value FROM appointments WHERE strftime('%Y-%m', starts_at) = strftime('%Y-%m', 'now', 'localtime') AND status = 'COMPLETED'").first<CountRow>(),
    env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS value FROM expenses WHERE strftime('%Y-%m', occurred_at) = strftime('%Y-%m', 'now', 'localtime')").first<CountRow>(),
    env.DB.prepare("SELECT COALESCE(SUM(total_amount), 0) AS value FROM payroll_periods WHERE strftime('%Y-%m', period_start) = strftime('%Y-%m', 'now', 'localtime')").first<CountRow>(),
    env.DB.prepare(`
      SELECT a.id, a.starts_at AS startsAt, a.status, a.total_amount AS amount,
        c.full_name AS clientName, c.phone AS clientPhone,
        e.full_name AS employeeName, b.name AS branchName
      FROM appointments a
      INNER JOIN clients c ON c.id = a.client_id
      LEFT JOIN employees e ON e.id = a.employee_id
      LEFT JOIN branches b ON b.id = a.branch_id
      WHERE a.starts_at >= datetime('now', 'localtime') AND a.status NOT IN ('CANCELLED', 'NO_SHOW')
      ORDER BY a.starts_at ASC LIMIT 6
    `).all(),
    env.DB.prepare("SELECT COUNT(*) AS value FROM employees WHERE is_active = 1").first<CountRow>(),
    env.DB.prepare(`
      SELECT date(starts_at) AS day, COALESCE(SUM(total_amount), 0) AS amount
      FROM appointments
      WHERE status = 'COMPLETED' AND starts_at >= datetime('now', 'localtime', '-6 days')
      GROUP BY date(starts_at)
      ORDER BY day ASC
    `).all(),
  ]);

  return json({
    ok: true,
    metrics: {
      clients: clients?.value ?? 0,
      todayAppointments: todayAppointments?.value ?? 0,
      monthAppointments: monthAppointments?.value ?? 0,
      revenue: revenue?.value ?? 0,
      expenses: expenses?.value ?? 0,
      payroll: payroll?.value ?? 0,
      activeEmployees: activeEmployees?.value ?? 0,
    },
    upcoming: upcoming.results ?? [],
    revenueByDay: revenueByDay.results ?? [],
  });
};
