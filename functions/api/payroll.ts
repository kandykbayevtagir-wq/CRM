import { auditStatement } from "../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, dateValue, json, newId, readJson, stringValue } from "../_lib/http";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "payroll.read")) return forbidden();
  const periodId = new URL(request.url).searchParams.get("id")?.trim();
  const periods = await env.DB.prepare("SELECT id, period_start AS periodStart, period_end AS periodEnd, status, total_amount AS totalAmount, closed_at AS closedAt, created_at AS createdAt FROM payroll_periods ORDER BY period_start DESC LIMIT 60").all();
  if (!periodId) return json({ ok: true, periods: periods.results ?? [] });
  const [period, lines, adjustments] = await Promise.all([
    env.DB.prepare("SELECT id, period_start AS periodStart, period_end AS periodEnd, status, total_amount AS totalAmount, closed_at AS closedAt FROM payroll_periods WHERE id = ?").bind(periodId).first(),
    env.DB.prepare("SELECT l.id, l.employee_id AS employeeId, e.full_name AS employeeName, l.fixed_amount AS fixedAmount, l.revenue_base AS revenueBase, l.revenue_percent AS revenuePercent, l.revenue_amount AS revenueAmount, l.bonus_amount AS bonusAmount, l.deduction_amount AS deductionAmount, l.advance_amount AS advanceAmount, l.manual_adjustment_amount AS manualAdjustmentAmount, l.total_amount AS totalAmount, l.details_json AS detailsJson FROM payroll_lines l INNER JOIN employees e ON e.id = l.employee_id WHERE l.period_id = ? ORDER BY e.full_name").bind(periodId).all(),
    env.DB.prepare("SELECT id, employee_id AS employeeId, kind, amount, reason, created_at AS createdAt FROM payroll_adjustments WHERE period_id = ? ORDER BY created_at DESC").bind(periodId).all(),
  ]);
  return json({ ok: true, periods: periods.results ?? [], period, lines: lines.results ?? [], adjustments: adjustments.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "payroll.write")) return forbidden();
  const body = await readJson(request);
  const periodStart = dateValue(body, "periodStart");
  const periodEndInput = stringValue(body, "periodEnd");
  const periodEnd = periodEndInput.length === 10 ? `${periodEndInput}T23:59:59.999Z` : dateValue(body, "periodEnd");
  if (!periodStart || !periodEnd || new Date(periodEnd).getTime() <= new Date(periodStart).getTime()) return badRequest("Укажите корректный период");
  const id = newId();
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO payroll_periods (id, period_start, period_end, status, total_amount) VALUES (?, ?, ?, 'DRAFT', 0)").bind(id, periodStart, periodEnd),
      auditStatement(env.DB, user, "payroll_period", id, "CREATE", null, { periodStart, periodEnd, status: "DRAFT" }),
    ]);
  } catch {
    return badRequest("Такой расчётный период уже существует");
  }
  return json({ ok: true, id }, 201);
};
