import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import { inRange, isValidCalendarDate, organizationTimezone, periodRange, zonedInstant } from "../_lib/dates";
import type { CrmEnv } from "../_lib/env";
import { badRequest, json, newId, optionalString, readJson, stringValue } from "../_lib/http";
import { nonNegativeNumber } from "../_lib/validation";
import { localDayRange } from "../../src/lib/appointments/schedule";

async function fact(db: D1Database, goal: { metric: string; periodStart: string; periodEnd: string; branchId: string | null; employeeId: string | null }) {
  const filters = ["a.status = 'COMPLETED'", inRange("a.starts_at")];
  const bindings: Array<string> = [goal.periodStart, goal.periodEnd];
  if (goal.branchId) { filters.push("a.branch_id = ?"); bindings.push(goal.branchId); }
  if (goal.employeeId) { filters.push("a.employee_id = ?"); bindings.push(goal.employeeId); }
  const where = filters.join(" AND ");
  if (goal.metric === "CLIENTS") {
    const row = await db.prepare(`SELECT COUNT(DISTINCT a.client_id) AS value FROM appointments a WHERE ${where}`).bind(...bindings).first<{ value: number }>();
    return Number(row?.value ?? 0);
  }
  if (goal.metric === "REPEAT_BOOKINGS") {
    const row = await db.prepare(`SELECT COUNT(*) AS value FROM appointments a WHERE ${where} AND EXISTS (SELECT 1 FROM appointments previous WHERE previous.client_id = a.client_id AND previous.status = 'COMPLETED' AND julianday(previous.starts_at) < julianday(a.starts_at))`).bind(...bindings).first<{ value: number }>();
    return Number(row?.value ?? 0);
  }
  const row = await db.prepare(`SELECT COALESCE(SUM(p.amount), 0) AS revenue, COUNT(DISTINCT a.id) AS appointments FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id WHERE ${where} AND p.payment_status = 'POSTED'`).bind(...bindings).first<{ revenue: number; appointments: number }>();
  const revenue = Number(row?.revenue ?? 0);
  return goal.metric === "AVERAGE_CHECK" ? (Number(row?.appointments ?? 0) ? revenue / Number(row?.appointments) : 0) : revenue;
}

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "goals.read")) return forbidden();
  const params = new URL(request.url).searchParams;
  const timezone = await organizationTimezone(env.DB);
  const { from, to } = periodRange(params.get("from"), params.get("to"), timezone);
  const rows = await env.DB.prepare("SELECT id, period_type AS periodType, period_start AS periodStart, period_end AS periodEnd, branch_id AS branchId, employee_id AS employeeId, metric, target_value AS targetValue, created_at AS createdAt FROM goals WHERE julianday(period_start) < julianday(?) AND julianday(period_end) > julianday(?) ORDER BY metric, target_value DESC").bind(to, from).all<{ id: string; periodType: string; periodStart: string; periodEnd: string; branchId: string | null; employeeId: string | null; metric: string; targetValue: number; createdAt: string }>();
  const items = await Promise.all((rows.results ?? []).map(async (goal) => {
    const current = await fact(env.DB, goal);
    const target = Number(goal.targetValue ?? 0);
    // Linear run-rate forecast for a period that has not ended yet.
    const start = Date.parse(goal.periodStart);
    const end = Date.parse(goal.periodEnd);
    const elapsed = Math.min(Math.max(Date.now() - start, 0), end - start);
    const forecast = elapsed > 0 && end > start && elapsed < end - start ? current / (elapsed / (end - start)) : current;
    return { ...goal, fact: current, completionPercent: target ? Number(Math.min(100, current / target * 100).toFixed(1)) : 0, forecast: Number(forecast.toFixed(2)) };
  }));
  return json({ ok: true, period: { from, to }, items });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "goals.write")) return forbidden();
  const body = await readJson(request);
  const timezone = await organizationTimezone(env.DB);
  const periodType = stringValue(body, "periodType", "MONTH").toUpperCase();
  const startRaw = stringValue(body, "periodStart");
  const endRaw = stringValue(body, "periodEnd");
  // Date-only values are organisation-local days; the end day is inclusive.
  const periodStart = zonedInstant(startRaw, timezone);
  const periodEnd = isValidCalendarDate(endRaw) ? localDayRange(endRaw, timezone).to : zonedInstant(endRaw, timezone);
  const metric = stringValue(body, "metric", "REVENUE").toUpperCase();
  const target = nonNegativeNumber(body.targetValue, "Цель");
  if (!["MONTH", "QUARTER"].includes(periodType) || !periodStart || !periodEnd || Date.parse(periodEnd) <= Date.parse(periodStart) || !["REVENUE", "CLIENTS", "AVERAGE_CHECK", "REPEAT_BOOKINGS"].includes(metric) || target === null || target <= 0) return badRequest("Проверьте период, метрику и цель");
  const branchId = optionalString(body, "branchId") || null;
  const employeeId = optionalString(body, "employeeId") || null;
  if (branchId && !await env.DB.prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1").bind(branchId).first()) return badRequest("Филиал не найден");
  if (employeeId && !await env.DB.prepare("SELECT id FROM employees WHERE id = ? AND is_active = 1").bind(employeeId).first()) return badRequest("Сотрудник не найден");
  const id = newId();
  await env.DB.prepare("INSERT INTO goals (id, period_type, period_start, period_end, branch_id, employee_id, metric, target_value, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, periodType, periodStart, periodEnd, branchId, employeeId, metric, target, user.id).run();
  return json({ ok: true, id }, 201);
};
