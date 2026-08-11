import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, json, newId, optionalString, readJson, stringValue } from "../_lib/http";
import { nonNegativeNumber } from "../_lib/validation";

function period(request: Request) {
  const params = new URL(request.url).searchParams;
  const now = new Date();
  const from = params.get("from") ? new Date(params.get("from") as string) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = params.get("to") ? new Date(params.get("to") as string) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from: from.toISOString(), to: to.toISOString() };
}

async function fact(db: D1Database, goal: { metric: string; periodStart: string; periodEnd: string; branchId: string | null; employeeId: string | null }) {
  const filters = ["a.status = 'COMPLETED'", "a.starts_at >= ?", "a.starts_at < ?"];
  const bindings: Array<string> = [goal.periodStart, goal.periodEnd];
  if (goal.branchId) { filters.push("a.branch_id = ?"); bindings.push(goal.branchId); }
  if (goal.employeeId) { filters.push("a.employee_id = ?"); bindings.push(goal.employeeId); }
  const where = filters.join(" AND ");
  if (goal.metric === "CLIENTS") {
    const row = await db.prepare(`SELECT COUNT(DISTINCT a.client_id) AS value FROM appointments a WHERE ${where}`).bind(...bindings).first<{ value: number }>();
    return Number(row?.value ?? 0);
  }
  if (goal.metric === "REPEAT_BOOKINGS") {
    const row = await db.prepare(`SELECT COUNT(*) AS value FROM appointments a WHERE ${where} AND EXISTS (SELECT 1 FROM appointments previous WHERE previous.client_id = a.client_id AND previous.status = 'COMPLETED' AND previous.starts_at < a.starts_at)`).bind(...bindings).first<{ value: number }>();
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
  const { from, to } = period(request);
  const rows = await env.DB.prepare("SELECT id, period_type AS periodType, period_start AS periodStart, period_end AS periodEnd, branch_id AS branchId, employee_id AS employeeId, metric, target_value AS targetValue, created_at AS createdAt FROM goals WHERE period_start < ? AND period_end > ? ORDER BY metric, target_value DESC").bind(to, from).all<{ id: string; periodType: string; periodStart: string; periodEnd: string; branchId: string | null; employeeId: string | null; metric: string; targetValue: number; createdAt: string }>();
  const items = await Promise.all((rows.results ?? []).map(async (goal) => {
    const current = await fact(env.DB, goal);
    const target = Number(goal.targetValue ?? 0);
    return { ...goal, fact: current, completionPercent: target ? Number((current / target * 100).toFixed(1)) : 0, forecast: current };
  }));
  return json({ ok: true, period: { from, to }, items });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "goals.write")) return forbidden();
  const body = await readJson(request);
  const periodType = stringValue(body, "periodType", "MONTH").toUpperCase();
  const periodStart = stringValue(body, "periodStart");
  const periodEnd = stringValue(body, "periodEnd");
  const metric = stringValue(body, "metric", "REVENUE").toUpperCase();
  const target = nonNegativeNumber(body.targetValue, "Цель");
  if (!["MONTH", "QUARTER"].includes(periodType) || !periodStart || !periodEnd || !["REVENUE", "CLIENTS", "AVERAGE_CHECK", "REPEAT_BOOKINGS"].includes(metric) || target === null) return badRequest("Проверьте период, метрику и цель");
  const id = newId();
  await env.DB.prepare("INSERT INTO goals (id, period_type, period_start, period_end, branch_id, employee_id, metric, target_value, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, periodType, periodStart, periodEnd, optionalString(body, "branchId"), optionalString(body, "employeeId"), metric, target, user.id).run();
  return json({ ok: true, id }, 201);
};
