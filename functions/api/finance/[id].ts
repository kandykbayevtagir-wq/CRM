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
  const existing = await env.DB.prepare("SELECT * FROM expenses WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!existing) return notFound("Операция не найдена");
  const body = await readJson(request);
  const title = stringValue(body, "title", String(existing.title ?? ""));
  const category = stringValue(body, "category", String(existing.category ?? "OTHER")).toUpperCase();
  const amount = nonNegativeNumber(body.amount ?? existing.amount, "Сумма");
  if (!title || amount === null || amount <= 0) return badRequest("Название и положительная сумма обязательны");
  const status = stringValue(body, "status", String(existing.status ?? "PAID")).toUpperCase() === "PLANNED" ? "PLANNED" : "PAID";
  const ledgerId = String(existing.ledger_transaction_id ?? `legacy-expense-${id}`);
  const occurredAt = dateValue(body, "occurredAt") || String(existing.occurred_at ?? new Date().toISOString());
  await env.DB.batch([
    env.DB.prepare("UPDATE expenses SET title = ?, category = ?, branch_id = ?, amount = ?, occurred_at = ?, status = ?, description = ?, ledger_transaction_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(title, category, optionalString(body, "branchId") ?? existing.branch_id ?? null, amount, occurredAt, status, body.description === null ? null : optionalString(body, "description") ?? existing.description ?? null, ledgerId, id),
    env.DB.prepare("UPDATE financial_transactions SET category = ?, amount = ?, status = ?, occurred_at = ?, branch_id = ?, description = ? WHERE id = ? AND expense_id = ?")
      .bind(category, amount, status === "PAID" ? "POSTED" : "PLANNED", occurredAt, optionalString(body, "branchId") ?? existing.branch_id ?? null, title, ledgerId, id),
    auditStatement(env.DB, user, "expense", id, "UPDATE", { title: existing.title, amount: existing.amount, status: existing.status }, { title, amount, status }),
  ]);
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "finance.write")) return forbidden();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const existing = await env.DB.prepare("SELECT id, amount, title, ledger_transaction_id AS ledgerId FROM expenses WHERE id = ?").bind(id).first<{ id: string; amount: number; title: string; ledgerId: string | null }>();
  if (!existing) return notFound("Операция не найдена");
  await env.DB.batch([
    env.DB.prepare("UPDATE financial_transactions SET status = 'VOIDED' WHERE expense_id = ?").bind(id),
    auditStatement(env.DB, user, "expense", id, "VOID", { title: existing.title, amount: existing.amount }, { ledgerId: existing.ledgerId, status: "VOIDED" }),
  ]);
  return json({ ok: true });
};
