import { auditStatement } from "../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, dateValue, json, notFound, optionalString, readJson, stringValue } from "../../_lib/http";
import { utilityValues } from "../../_lib/utility";

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "finance.write")) return forbidden();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const existing = await env.DB.prepare("SELECT * FROM utility_payments WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!existing) return notFound("Коммунальный платёж не найден");
  const body = await readJson(request);
  const values = utilityValues(body, existing);
  const status = stringValue(body, "status", String(existing.status ?? "PLANNED")).toUpperCase();
  if (!values || values.amount <= 0 || !["PLANNED", "DUE", "PAID", "OVERDUE"].includes(status)) return badRequest("Проверьте показания, тариф и статус");
  const ledgerId = String(existing.ledger_transaction_id ?? (status === "PAID" ? `utility-${id}` : "")) || null;
  const paidAt = status === "PAID" ? dateValue(body, "paidAt") || String(existing.paid_at ?? new Date().toISOString()) : null;
  const statements: D1PreparedStatement[] = [env.DB.prepare("UPDATE utility_payments SET kind = ?, period_start = ?, previous_meter_value = ?, current_meter_value = ?, consumption = ?, tariff = ?, fixed_fee = ?, amount = ?, due_date = ?, status = ?, paid_at = ?, note = ?, ledger_transaction_id = ? WHERE id = ?").bind(stringValue(body, "kind", String(existing.kind ?? "OTHER")), dateValue(body, "periodStart") || existing.period_start, values.previous, values.current, values.consumption, values.tariff, values.fixedFee, values.amount, dateValue(body, "dueDate") || existing.due_date, status, paidAt, body.note === null ? null : optionalString(body, "note") ?? existing.note ?? null, ledgerId, id)];
  if (ledgerId) statements.push(env.DB.prepare("INSERT OR IGNORE INTO financial_transactions (id, direction, kind, category, amount, status, occurred_at, branch_id, utility_payment_id, description, created_by) VALUES (?, 'EXPENSE', 'UTILITIES', 'UTILITIES', ?, 'POSTED', ?, ?, ?, ?, ?)").bind(ledgerId, values.amount, paidAt ?? new Date().toISOString(), existing.branch_id, id, String(existing.kind ?? "OTHER"), user.id), env.DB.prepare("UPDATE financial_transactions SET amount = ?, status = ?, occurred_at = ?, description = ? WHERE utility_payment_id = ? AND kind = 'UTILITIES'").bind(values.amount, status === "PAID" ? "POSTED" : "PLANNED", paidAt ?? existing.due_date, stringValue(body, "kind", String(existing.kind ?? "OTHER")), id));
  else statements.push(env.DB.prepare("UPDATE financial_transactions SET status = 'VOIDED' WHERE utility_payment_id = ? AND kind = 'UTILITIES'").bind(id));
  statements.push(auditStatement(env.DB, user, "utility_payment", id, "UPDATE", { amount: existing.amount, consumption: existing.consumption }, { amount: values.amount, consumption: values.consumption, status }));
  await env.DB.batch(statements);
  return json({ ok: true, consumption: values.consumption, amount: values.amount });
};
