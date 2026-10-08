import { auditStatement } from "../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, newId, notFound, readJson, stringValue } from "../../_lib/http";
import { nonNegativeMoney } from "../../_lib/validation";
import { mutationReceipt } from "../../_lib/mutation-receipt";

const kinds = new Set(["BONUS", "DEDUCTION", "ADVANCE", "MANUAL"]);

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "payroll.write")) return forbidden();
  const body = await readJson(request);
  const receipt = await mutationReceipt(env.DB, user.id, "payroll:adjustment", body);
  if (receipt.replay) return receipt.replay;
  const periodId = stringValue(body, "periodId");
  const employeeId = stringValue(body, "employeeId");
  const kind = stringValue(body, "kind").toUpperCase();
  const reason = stringValue(body, "reason").slice(0, 500);
  const amount = nonNegativeMoney(body.amount, "Сумма");
  if (!periodId || !employeeId || !kinds.has(kind) || !reason || amount === null || amount <= 0) return badRequest("Проверьте сотрудника, вид, причину и положительную сумму");
  const period = await env.DB.prepare("SELECT id, status FROM payroll_periods WHERE id = ?").bind(periodId).first<{ id: string; status: string }>();
  if (!period) return notFound("Расчётный период не найден");
  if (period.status === "CLOSED") return badRequest("Закрытый период нельзя изменять");
  const employee = await env.DB.prepare("SELECT id FROM employees WHERE id = ? AND is_active = 1").bind(employeeId).first();
  if (!employee) return notFound("Сотрудник не найден");
  const id = newId();
  return receipt.commit([
    env.DB.prepare("INSERT INTO payroll_adjustments (id, employee_id, period_id, kind, amount, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, employeeId, periodId, kind, amount, reason, user.id),
    auditStatement(env.DB, user, "payroll_adjustment", id, "CREATE", null, { periodId, employeeId, kind, amount, reason }),
  ], { ok: true, id });
};
