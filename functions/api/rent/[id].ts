import { auditStatement } from "../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, dateValue, json, notFound, optionalString, readJson, stringValue } from "../../_lib/http";
import { nonNegativeNumber } from "../../_lib/validation";

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "finance.write")) return forbidden();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const existing = await env.DB.prepare("SELECT * FROM rent_payments WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!existing) return notFound("Платёж аренды не найден");
  const body = await readJson(request);
  const amount = nonNegativeNumber(body.amount ?? existing.amount, "Сумма");
  const statusValue = stringValue(body, "status", String(existing.status ?? "PLANNED")).toUpperCase();
  if (amount === null || amount <= 0 || !["PLANNED", "DUE", "PAID", "OVERDUE"].includes(statusValue)) return badRequest("Проверьте сумму и статус аренды");
  const ledgerId = String(existing.ledger_transaction_id ?? (statusValue === "PAID" ? `rent-${id}` : "")) || null;
  const paidAt = statusValue === "PAID" ? dateValue(body, "paidAt") || String(existing.paid_at ?? new Date().toISOString()) : null;
  const statements: D1PreparedStatement[] = [env.DB.prepare("UPDATE rent_payments SET amount = ?, due_date = ?, status = ?, paid_at = ?, note = ?, ledger_transaction_id = ? WHERE id = ?").bind(amount, dateValue(body, "dueDate") || existing.due_date, statusValue, paidAt, body.note === null ? null : optionalString(body, "note") ?? existing.note ?? null, ledgerId, id)];
  if (ledgerId) statements.push(env.DB.prepare("INSERT OR IGNORE INTO financial_transactions (id, direction, kind, category, amount, status, occurred_at, branch_id, rent_payment_id, description, created_by) VALUES (?, 'EXPENSE', 'RENT', 'RENT', ?, 'POSTED', ?, ?, ?, ?, ?)").bind(ledgerId, amount, paidAt ?? new Date().toISOString(), existing.branch_id, id, optionalString(body, "note") ?? "Аренда", user.id), env.DB.prepare("UPDATE financial_transactions SET amount = ?, status = ?, occurred_at = ?, branch_id = ?, description = ? WHERE rent_payment_id = ? AND kind = 'RENT'").bind(amount, statusValue === "PAID" ? "POSTED" : "PLANNED", paidAt ?? existing.due_date, existing.branch_id, optionalString(body, "note") ?? existing.note ?? "Аренда", id));
  else statements.push(env.DB.prepare("UPDATE financial_transactions SET status = 'VOIDED' WHERE rent_payment_id = ? AND kind = 'RENT'").bind(id));
  statements.push(auditStatement(env.DB, user, "rent_payment", id, "UPDATE", { amount: existing.amount, status: existing.status }, { amount, status: statusValue }));
  await env.DB.batch(statements);
  return json({ ok: true });
};
