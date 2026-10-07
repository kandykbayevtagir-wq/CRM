import { auditStatement } from "../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, conflict, json, newId, readJson, stringValue } from "../_lib/http";
import { isValidCalendarDate, organizationTimezone, zonedInstant } from "../_lib/dates";
import { localDayRange } from "../../src/lib/appointments/schedule";

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
  const timezone = await organizationTimezone(env.DB);
  // Date-only input means organisation-local calendar days; the end day is inclusive (stored as the exclusive next midnight).
  const startInput = stringValue(body, "periodStart");
  const endInput = stringValue(body, "periodEnd");
  const periodStart = zonedInstant(startInput, timezone);
  const periodEnd = isValidCalendarDate(endInput) ? localDayRange(endInput, timezone).to : zonedInstant(endInput, timezone);
  if (!periodStart || !periodEnd || Date.parse(periodEnd) <= Date.parse(periodStart)) return badRequest("Укажите корректный период");
  if (Date.parse(periodEnd) - Date.parse(periodStart) > 366 * 86_400_000) return badRequest("Расчётный период не может быть длиннее года");
  // Overlapping periods would count the same payments twice in payroll and in the ledger.
  const overlap = await env.DB.prepare("SELECT id, period_start AS periodStart, period_end AS periodEnd FROM payroll_periods WHERE julianday(period_start) < julianday(?) AND julianday(period_end) > julianday(?) LIMIT 1").bind(periodEnd, periodStart).first<{ id: string; periodStart: string; periodEnd: string }>();
  if (overlap) return conflict("Период пересекается с уже существующим расчётным периодом");
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
