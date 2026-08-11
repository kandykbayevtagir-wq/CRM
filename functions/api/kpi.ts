import Decimal from "decimal.js";

import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { json } from "../_lib/http";
import { calculateAvailableWorkingMinutes } from "../_lib/working-time";
import { metricSnapshot } from "./pnl";

function range(request: Request) {
  const params = new URL(request.url).searchParams;
  const now = new Date();
  const from = params.get("from") ? new Date(params.get("from") as string) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = params.get("to") ? new Date(params.get("to") as string) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from: from.toISOString(), to: to.toISOString() };
}

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "kpi.read")) return forbidden();
  const { from, to } = range(request);
  const params = new URL(request.url).searchParams;
  const branchId = params.get("branchId")?.trim() ?? "";
  const branchCondition = branchId ? " AND EXISTS (SELECT 1 FROM employee_branches eb WHERE eb.employee_id = e.id AND eb.branch_id = ?)" : "";
  const branchBinding = branchId ? [branchId] : [];
  const [employees, schedules, timeOff, occupied, noShows, cancellations, refunds, payroll, snapshot, settings] = await Promise.all([
    env.DB.prepare(`SELECT e.id AS employeeId, e.full_name AS employeeName FROM employees e WHERE e.is_active = 1${branchCondition} ORDER BY e.full_name`).bind(...branchBinding).all<{ employeeId: string; employeeName: string }>(),
    env.DB.prepare(`SELECT employee_id AS employeeId, day_of_week AS dayOfWeek, starts_time AS startsTime, ends_time AS endsTime, break_start_time AS breakStartTime, break_end_time AS breakEndTime FROM employee_schedules WHERE is_active = 1${branchId ? " AND EXISTS (SELECT 1 FROM employee_branches eb WHERE eb.employee_id = employee_schedules.employee_id AND eb.branch_id = ?)" : ""}`).bind(...branchBinding).all<{ employeeId: string; dayOfWeek: number; startsTime: string; endsTime: string; breakStartTime: string | null; breakEndTime: string | null }>(),
    env.DB.prepare(`SELECT employee_id AS employeeId, starts_at AS startsAt, ends_at AS endsAt FROM employee_time_off WHERE ends_at >= ? AND starts_at < ?${branchId ? " AND EXISTS (SELECT 1 FROM employee_branches eb WHERE eb.employee_id = employee_time_off.employee_id AND eb.branch_id = ?)" : ""}`).bind(from, to, ...branchBinding).all<{ employeeId: string; startsAt: string; endsAt: string }>(),
    env.DB.prepare(`SELECT employee_id AS employeeId, COALESCE(SUM((julianday(ends_at) - julianday(starts_at)) * 1440), 0) AS value FROM appointments WHERE status = 'COMPLETED' AND starts_at >= ? AND starts_at < ?${branchId ? " AND branch_id = ?" : ""} GROUP BY employee_id`).bind(from, to, ...branchBinding).all<{ employeeId: string; value: number }>(),
    env.DB.prepare(`SELECT employee_id AS employeeId, COUNT(*) AS value FROM appointments WHERE status = 'NO_SHOW' AND starts_at >= ? AND starts_at < ?${branchId ? " AND branch_id = ?" : ""} GROUP BY employee_id`).bind(from, to, ...branchBinding).all<{ employeeId: string; value: number }>(),
    env.DB.prepare(`SELECT employee_id AS employeeId, COUNT(*) AS value FROM appointments WHERE status = 'CANCELLED' AND starts_at >= ? AND starts_at < ?${branchId ? " AND branch_id = ?" : ""} GROUP BY employee_id`).bind(from, to, ...branchBinding).all<{ employeeId: string; value: number }>(),
    env.DB.prepare(`SELECT a.employee_id AS employeeId, COALESCE(SUM(pa.amount), 0) AS value FROM payment_adjustments pa INNER JOIN payments p ON p.id = pa.payment_id INNER JOIN appointments a ON a.id = p.appointment_id WHERE a.status = 'COMPLETED' AND pa.occurred_at >= ? AND pa.occurred_at < ?${branchId ? " AND a.branch_id = ?" : ""} GROUP BY a.employee_id`).bind(from, to, ...branchBinding).all<{ employeeId: string; value: number }>(),
    env.DB.prepare(`SELECT l.employee_id AS employeeId, COALESCE(SUM(l.total_amount), 0) AS value FROM payroll_lines l INNER JOIN payroll_periods pp ON pp.id = l.period_id WHERE pp.status IN ('CALCULATED', 'CLOSED') AND pp.period_start < ? AND pp.period_end >= ? GROUP BY l.employee_id`).bind(to, from).all<{ employeeId: string; value: number }>(),
    metricSnapshot(env.DB, from, to, request),
    env.DB.prepare("SELECT timezone FROM organization_settings WHERE id = 1").first<{ timezone: string }>(),
  ]);
  const occupancyMap = new Map((occupied.results ?? []).map((row) => [row.employeeId, Number(row.value ?? 0)]));
  const noShowMap = new Map((noShows.results ?? []).map((row) => [row.employeeId, Number(row.value ?? 0)]));
  const cancellationMap = new Map((cancellations.results ?? []).map((row) => [row.employeeId, Number(row.value ?? 0)]));
  const refundsMap = new Map((refunds.results ?? []).map((row) => [row.employeeId, Number(row.value ?? 0)]));
  const payrollMap = new Map((payroll.results ?? []).map((row) => [row.employeeId, Number(row.value ?? 0)]));
  const revenueMap = new Map((snapshot.employeeRevenue ?? []).map((row) => [row.employeeId, row]));
  const kpiRows = await Promise.all((employees.results ?? []).map(async (employee) => {
    const employeeSchedules = (schedules.results ?? []).filter((row) => row.employeeId === employee.employeeId);
    const employeeTimeOff = (timeOff.results ?? []).filter((row) => row.employeeId === employee.employeeId);
    const availableMinutes = calculateAvailableWorkingMinutes(employeeSchedules, employeeTimeOff, new Date(from), new Date(to), settings?.timezone ?? "Asia/Almaty");
    const occupiedMinutes = occupancyMap.get(employee.employeeId) ?? 0;
    const completed = revenueMap.get(employee.employeeId)?.appointments ?? 0;
    const revenue = new Decimal(revenueMap.get(employee.employeeId)?.revenue ?? 0);
    const refundsValue = new Decimal(refundsMap.get(employee.employeeId) ?? 0);
    const firstTime = await env.DB.prepare(`SELECT COUNT(DISTINCT a.client_id) AS value FROM appointments a WHERE a.employee_id = ? AND a.status = 'COMPLETED' AND a.starts_at >= ? AND a.starts_at < ? AND NOT EXISTS (SELECT 1 FROM appointments previous WHERE previous.client_id = a.client_id AND previous.status = 'COMPLETED' AND previous.starts_at < ?)`)
      .bind(employee.employeeId, from, to, from).first<{ value: number }>();
    const returning = await env.DB.prepare(`SELECT COUNT(DISTINCT a.client_id) AS value FROM appointments a WHERE a.employee_id = ? AND a.status = 'COMPLETED' AND a.starts_at >= ? AND a.starts_at < ? AND EXISTS (SELECT 1 FROM appointments previous WHERE previous.client_id = a.client_id AND previous.status = 'COMPLETED' AND previous.starts_at < ?)`)
      .bind(employee.employeeId, from, to, from).first<{ value: number }>();
    const contribution = revenue.minus(new Decimal(revenueMap.get(employee.employeeId)?.consumables ?? 0)).minus(new Decimal(revenueMap.get(employee.employeeId)?.commission ?? 0));
    return { employeeId: employee.employeeId, employeeName: employee.employeeName, completedAppointments: completed, revenue: Number(revenue.toFixed(2)), paidRevenue: Number(revenue.toFixed(2)), averageCheck: completed ? Number(revenue.div(completed).toFixed(2)) : 0, availableMinutes, occupiedMinutes: Math.round(occupiedMinutes), freeMinutes: Math.max(0, availableMinutes - Math.round(occupiedMinutes)), occupancy: availableMinutes ? Number(Math.min(100, occupiedMinutes / availableMinutes * 100).toFixed(1)) : 0, noShows: noShowMap.get(employee.employeeId) ?? 0, cancellations: cancellationMap.get(employee.employeeId) ?? 0, refunds: Number(refundsValue.toFixed(2)), newClients: Number(firstTime?.value ?? 0), returningClients: Number(returning?.value ?? 0), repeatBookingRate: completed ? Number((Number(returning?.value ?? 0) / completed * 100).toFixed(1)) : 0, consumablesCost: Number(new Decimal(revenueMap.get(employee.employeeId)?.consumables ?? 0).toFixed(2)), contributionMargin: Number(contribution.toFixed(2)), payroll: payrollMap.get(employee.employeeId) ?? 0 };
  }));
  return json({ ok: true, period: { from, to }, items: kpiRows });
};
