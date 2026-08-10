import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { json } from "../_lib/http";
import { calculateAvailableWorkingMinutes } from "../_lib/working-time";

function period(request: Request) {
  const params = new URL(request.url).searchParams;
  const now = new Date();
  const start = params.get("from") ? new Date(params.get("from") as string) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = params.get("to") ? new Date(params.get("to") as string) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: Number.isNaN(start.getTime()) ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) : start, end: Number.isNaN(end.getTime()) ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) : end };
}

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "reports.read")) return forbidden();
  const params = new URL(request.url).searchParams;
  const { start, end } = period(request);
  const from = start.toISOString();
  const to = end.toISOString();
  const branchId = params.get("branchId")?.trim() ?? "";
  const employeeId = params.get("employeeId")?.trim() ?? "";
  const serviceId = params.get("serviceId")?.trim() ?? "";
  const category = params.get("category")?.trim() ?? "";
  const appointmentFilters = ["a.starts_at >= ?", "a.starts_at < ?"];
  const appointmentBindings: string[] = [from, to];
  const ledgerFilters = ["x.occurred_at >= ?", "x.occurred_at < ?", "x.status = 'POSTED'"];
  const ledgerBindings: string[] = [from, to];
  if (branchId) { appointmentFilters.push("a.branch_id = ?"); appointmentBindings.push(branchId); ledgerFilters.push("x.branch_id = ?"); ledgerBindings.push(branchId); }
  if (employeeId) { appointmentFilters.push("a.employee_id = ?"); appointmentBindings.push(employeeId); }
  if (serviceId) { appointmentFilters.push("EXISTS (SELECT 1 FROM appointment_services sf WHERE sf.appointment_id = a.id AND sf.service_id = ?)"); appointmentBindings.push(serviceId); }
  if (category) { appointmentFilters.push("EXISTS (SELECT 1 FROM appointment_services sc INNER JOIN services svc ON svc.id = sc.service_id WHERE sc.appointment_id = a.id AND svc.category = ?)"); appointmentBindings.push(category); }
  const appointmentWhere = appointmentFilters.join(" AND ");
  const scopedBindings = [branchId, employeeId, serviceId, category].filter(Boolean);
  const employeeJoinFilters = [
    ...(branchId ? ["a.branch_id = ?"] : []),
    ...(serviceId ? ["EXISTS (SELECT 1 FROM appointment_services sf WHERE sf.appointment_id = a.id AND sf.service_id = ?)"] : []),
    ...(category ? ["EXISTS (SELECT 1 FROM appointment_services sc INNER JOIN services svc ON svc.id = sc.service_id WHERE sc.appointment_id = a.id AND svc.category = ?)"] : []),
  ];
  const employeeJoinBindings = [branchId, serviceId, category].filter(Boolean);
  const employeeWhere = employeeId ? " WHERE e.id = ?" : "";
  const employeeWhereBindings = employeeId ? [employeeId] : [];
  const [appointmentCounts, grossRevenue, refunds, expenses, payroll, clientCounts, employeeRevenueAppointments, employeeRevenue, employeeRevenueRefunds, serviceRevenueLines, occupied, schedules, timeOff, settings] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN a.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed, SUM(CASE WHEN a.status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled, SUM(CASE WHEN a.status = 'NO_SHOW' THEN 1 ELSE 0 END) AS noShow, COUNT(DISTINCT CASE WHEN a.status = 'COMPLETED' THEN a.client_id END) AS uniqueClients FROM appointments a WHERE ${appointmentWhere}`).bind(...appointmentBindings).first<Record<string, number>>(),
    env.DB.prepare(`SELECT COALESCE(SUM(p.amount), 0) AS value FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id WHERE a.status = 'COMPLETED' AND p.payment_status = 'POSTED' AND p.paid_at >= ? AND p.paid_at < ?${branchId ? " AND a.branch_id = ?" : ""}${employeeId ? " AND a.employee_id = ?" : ""}${serviceId ? " AND EXISTS (SELECT 1 FROM appointment_services sf WHERE sf.appointment_id = a.id AND sf.service_id = ?)" : ""}${category ? " AND EXISTS (SELECT 1 FROM appointment_services sc INNER JOIN services svc ON svc.id = sc.service_id WHERE sc.appointment_id = a.id AND svc.category = ?)" : ""}`).bind(from, to, ...[branchId, employeeId, serviceId, category].filter(Boolean)).first<{ value: number }>(),
    env.DB.prepare(`SELECT COALESCE(SUM(pa.amount), 0) AS value FROM payment_adjustments pa INNER JOIN payments p ON p.id = pa.payment_id INNER JOIN appointments a ON a.id = p.appointment_id WHERE a.status = 'COMPLETED' AND pa.occurred_at >= ? AND pa.occurred_at < ?${branchId ? " AND a.branch_id = ?" : ""}${employeeId ? " AND a.employee_id = ?" : ""}${serviceId ? " AND EXISTS (SELECT 1 FROM appointment_services sf WHERE sf.appointment_id = a.id AND sf.service_id = ?)" : ""}${category ? " AND EXISTS (SELECT 1 FROM appointment_services sc INNER JOIN services svc ON svc.id = sc.service_id WHERE sc.appointment_id = a.id AND svc.category = ?)" : ""}`).bind(from, to, ...scopedBindings).first<{ value: number }>(),
    env.DB.prepare(`SELECT COALESCE(SUM(x.amount), 0) AS value FROM financial_transactions x WHERE ${ledgerFilters.join(" AND ")} AND x.direction = 'EXPENSE' AND x.kind <> 'SALARY'`).bind(...ledgerBindings).first<{ value: number }>(),
    env.DB.prepare("SELECT COALESCE(SUM(l.total_amount), 0) AS value FROM payroll_lines l INNER JOIN payroll_periods p ON p.id = l.period_id WHERE p.status IN ('CALCULATED', 'CLOSED') AND p.period_start >= ? AND p.period_start < ?").bind(from, to).first<{ value: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS totalClients, SUM(CASE WHEN visitCount > 1 THEN 1 ELSE 0 END) AS returningClients, SUM(CASE WHEN createdAt >= ? AND createdAt < ? THEN 1 ELSE 0 END) AS newClients FROM (SELECT c.id, c.created_at AS createdAt, COUNT(CASE WHEN a.status = 'COMPLETED' THEN 1 END) AS visitCount FROM clients c LEFT JOIN appointments a ON a.client_id = c.id AND a.starts_at >= ? AND a.starts_at < ? GROUP BY c.id)`).bind(from, to, from, to).first<Record<string, number>>(),
    env.DB.prepare(`SELECT e.id AS employeeId, e.full_name AS employeeName, COUNT(DISTINCT a.id) AS appointments FROM employees e LEFT JOIN appointments a ON a.employee_id = e.id AND a.status = 'COMPLETED' AND a.starts_at >= ? AND a.starts_at < ?${employeeJoinFilters.length ? ` AND ${employeeJoinFilters.join(" AND ")}` : ""}${employeeWhere} GROUP BY e.id ORDER BY appointments DESC`).bind(from, to, ...employeeJoinBindings, ...employeeWhereBindings).all<{ employeeId: string; employeeName: string; appointments: number }>(),
    env.DB.prepare(`SELECT a.employee_id AS employeeId, COALESCE(SUM(p.amount), 0) AS value FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id WHERE a.status = 'COMPLETED' AND p.payment_status = 'POSTED' AND p.paid_at >= ? AND p.paid_at < ?${employeeId ? " AND a.employee_id = ?" : ""}${branchId ? " AND a.branch_id = ?" : ""}${serviceId ? " AND EXISTS (SELECT 1 FROM appointment_services sf WHERE sf.appointment_id = a.id AND sf.service_id = ?)" : ""}${category ? " AND EXISTS (SELECT 1 FROM appointment_services sc INNER JOIN services svc ON svc.id = sc.service_id WHERE sc.appointment_id = a.id AND svc.category = ?)" : ""} GROUP BY a.employee_id`).bind(from, to, ...[employeeId, branchId, serviceId, category].filter(Boolean)).all<{ employeeId: string; value: number }>(),
    env.DB.prepare(`SELECT a.employee_id AS employeeId, COALESCE(SUM(pa.amount), 0) AS value FROM payment_adjustments pa INNER JOIN payments p ON p.id = pa.payment_id INNER JOIN appointments a ON a.id = p.appointment_id WHERE a.status = 'COMPLETED' AND pa.occurred_at >= ? AND pa.occurred_at < ?${employeeId ? " AND a.employee_id = ?" : ""}${branchId ? " AND a.branch_id = ?" : ""}${serviceId ? " AND EXISTS (SELECT 1 FROM appointment_services sf WHERE sf.appointment_id = a.id AND sf.service_id = ?)" : ""}${category ? " AND EXISTS (SELECT 1 FROM appointment_services sc INNER JOIN services svc ON svc.id = sc.service_id WHERE sc.appointment_id = a.id AND svc.category = ?)" : ""} GROUP BY a.employee_id`).bind(from, to, ...[employeeId, branchId, serviceId, category].filter(Boolean)).all<{ employeeId: string; value: number }>(),
    env.DB.prepare(`SELECT s.id AS serviceId, s.name AS serviceName, s.category, a.id AS appointmentId, a.total_amount AS appointmentAmount, aps.price, aps.quantity,
      COALESCE((SELECT SUM(p2.amount) FROM payments p2 WHERE p2.appointment_id = a.id AND p2.payment_status = 'POSTED' AND p2.paid_at >= ? AND p2.paid_at < ?), 0) AS grossPaid,
      COALESCE((SELECT SUM(pa2.amount) FROM payment_adjustments pa2 INNER JOIN payments p3 ON p3.id = pa2.payment_id WHERE p3.appointment_id = a.id AND pa2.occurred_at >= ? AND pa2.occurred_at < ?), 0) AS refunded
      FROM appointment_services aps INNER JOIN services s ON s.id = aps.service_id INNER JOIN appointments a ON a.id = aps.appointment_id
      WHERE a.status = 'COMPLETED' AND a.starts_at >= ? AND a.starts_at < ?${branchId ? " AND a.branch_id = ?" : ""}${employeeId ? " AND a.employee_id = ?" : ""}${serviceId ? " AND aps.service_id = ?" : ""}${category ? " AND s.category = ?" : ""}`).bind(from, to, from, to, from, to, ...scopedBindings).all<{ serviceId: string; serviceName: string; category: string; appointmentId: string; appointmentAmount: number; price: number; quantity: number; grossPaid: number; refunded: number }>(),
    env.DB.prepare(`SELECT COALESCE(SUM((julianday(a.ends_at) - julianday(a.starts_at)) * 1440), 0) AS value FROM appointments a WHERE a.status NOT IN ('CANCELLED', 'NO_SHOW') AND a.ends_at IS NOT NULL AND ${appointmentWhere}`).bind(...appointmentBindings).first<{ value: number }>(),
    env.DB.prepare("SELECT employee_id AS employeeId, day_of_week AS dayOfWeek, starts_time AS startsTime, ends_time AS endsTime, break_start_time AS breakStartTime, break_end_time AS breakEndTime FROM employee_schedules WHERE is_active = 1").all<{ employeeId: string; dayOfWeek: number; startsTime: string; endsTime: string; breakStartTime: string | null; breakEndTime: string | null }>(),
    env.DB.prepare("SELECT employee_id AS employeeId, starts_at AS startsAt, ends_at AS endsAt FROM employee_time_off WHERE ends_at >= ? AND starts_at < ?").bind(from, to).all<{ employeeId: string; startsAt: string; endsAt: string }>(),
    env.DB.prepare("SELECT timezone FROM organization_settings WHERE id = 1").first<{ timezone: string }>(),
  ]);
  const revenue = Number(grossRevenue?.value ?? 0) - Number(refunds?.value ?? 0);
  const expenseAmount = Number(expenses?.value ?? 0);
  const salaryFund = Number(payroll?.value ?? 0);
  const profit = revenue - expenseAmount - salaryFund;
  let scopedSchedules = schedules.results ?? [];
  if (employeeId) scopedSchedules = scopedSchedules.filter((row) => row.employeeId === employeeId);
  const availableMinutes = calculateAvailableWorkingMinutes(scopedSchedules, timeOff.results ?? [], start, end, settings?.timezone ?? "Asia/Almaty");
  const occupiedMinutes = Number(occupied?.value ?? 0);
  const completed = Number(appointmentCounts?.completed ?? 0);
  const uniqueClients = Number(appointmentCounts?.uniqueClients ?? 0);
  const returningClients = Number(clientCounts?.returningClients ?? 0);
  const employeeGross = new Map((employeeRevenue.results ?? []).map((row) => [String(row.employeeId), Number(row.value ?? 0)]));
  const employeeRefunds = new Map((employeeRevenueRefunds.results ?? []).map((row) => [String(row.employeeId), Number(row.value ?? 0)]));
  const employeeRows = (employeeRevenueAppointments.results ?? []).map((row) => ({
    employeeId: String(row.employeeId),
    employeeName: String(row.employeeName),
    appointments: Number(row.appointments ?? 0),
    revenue: Math.max(0, (employeeGross.get(String(row.employeeId)) ?? 0) - (employeeRefunds.get(String(row.employeeId)) ?? 0)),
  }));
  const serviceMap = new Map<string, { serviceId: string; serviceName: string; category: string; revenue: number; snapshotAmount: number; appointmentIds: Set<string> }>();
  for (const row of serviceRevenueLines.results ?? []) {
    const serviceIdValue = String(row.serviceId);
    const lineAmount = Number(row.price ?? 0) * Number(row.quantity ?? 1);
    const appointmentAmount = Number(row.appointmentAmount ?? 0);
    const netPaid = Number(row.grossPaid ?? 0) - Number(row.refunded ?? 0);
    const allocatedRevenue = appointmentAmount > 0 ? (lineAmount / appointmentAmount) * netPaid : 0;
    const current = serviceMap.get(serviceIdValue) ?? { serviceId: serviceIdValue, serviceName: String(row.serviceName), category: String(row.category), revenue: 0, snapshotAmount: 0, appointmentIds: new Set<string>() };
    current.revenue += allocatedRevenue;
    current.snapshotAmount += lineAmount;
    current.appointmentIds.add(String(row.appointmentId));
    serviceMap.set(serviceIdValue, current);
  }
  const serviceRows = Array.from(serviceMap.values()).map((row) => ({ serviceId: row.serviceId, serviceName: row.serviceName, category: row.category, revenue: row.revenue, snapshotAmount: row.snapshotAmount, appointments: row.appointmentIds.size })).sort((left, right) => right.revenue - left.revenue);
  return json({ ok: true, period: { from, to }, filters: { branchId: branchId || null, employeeId: employeeId || null, serviceId: serviceId || null, category: category || null }, metrics: { revenue, grossRevenue: Number(grossRevenue?.value ?? 0), refunds: Number(refunds?.value ?? 0), expenses: expenseAmount, payroll: salaryFund, profit, margin: revenue ? Math.round((profit / revenue) * 1000) / 10 : 0, appointments: Number(appointmentCounts?.total ?? 0), completed, cancelled: Number(appointmentCounts?.cancelled ?? 0), noShow: Number(appointmentCounts?.noShow ?? 0), newClients: Number(clientCounts?.newClients ?? 0), uniqueClients, returningClients, repeatVisitRate: uniqueClients ? Math.round((returningClients / uniqueClients) * 1000) / 10 : 0, averageCheck: completed ? revenue / completed : 0, occupiedMinutes: Math.round(occupiedMinutes), availableWorkingMinutes: Math.round(availableMinutes), occupancy: availableMinutes ? Math.min(100, Math.round((occupiedMinutes / availableMinutes) * 1000) / 10) : 0, revenuePerHour: occupiedMinutes ? revenue / (occupiedMinutes / 60) : 0 }, employeeRevenue: employeeRows, serviceRevenue: serviceRows });
};
