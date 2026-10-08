import { auditStatement } from "../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, conflict, json, notFound, optionalString, readJson, stringValue } from "../../_lib/http";
import { nonNegativeMoney } from "../../_lib/validation";
import { organizationTimezone, zonedDateValue } from "../../_lib/dates";
import { assertUnchanged } from "../../_lib/transaction";

const categories = new Set(["RENT", "UTILITIES", "SALARY", "SUPPLIES", "MARKETING", "TAX", "EQUIPMENT", "OTHER"]);

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "finance.write")) return forbidden();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const existing = await env.DB.prepare("SELECT * FROM expenses WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!existing) return notFound("Операция не найдена");
  // A voided expense is closed history: it must not be re-posted through an edit.
  const voided = await env.DB.prepare("SELECT id FROM financial_transactions WHERE expense_id = ? AND status = 'VOIDED' LIMIT 1").bind(id).first();
  if (voided) return conflict("Операция аннулирована и больше не редактируется. Создайте новый расход.");
  const body = await readJson(request);
  const title = (stringValue(body, "title", String(existing.title ?? "")) || String(existing.title ?? "")).slice(0, 200);
  const categoryValue = stringValue(body, "category", String(existing.category ?? "OTHER")).toUpperCase();
  const category = categories.has(categoryValue) ? categoryValue : String(existing.category ?? "OTHER");
  const amount = nonNegativeMoney(body.amount ?? existing.amount, "Сумма");
  if (!title || amount === null || amount <= 0) return badRequest("Название и положительная сумма обязательны");
  const status = stringValue(body, "status", String(existing.status ?? "PAID")).toUpperCase() === "PLANNED" ? "PLANNED" : "PAID";
  const ledgerId = String(existing.ledger_transaction_id ?? `legacy-expense-${id}`);
  const occurredAt = zonedDateValue(body, "occurredAt", await organizationTimezone(env.DB)) || String(existing.occurred_at ?? new Date().toISOString());
  await env.DB.batch([
    ...assertUnchanged(env.DB, "expenses", String(id), Number(existing.revision)),
    env.DB.prepare("UPDATE expenses SET title = ?, category = ?, branch_id = ?, amount = ?, occurred_at = ?, status = ?, description = ?, ledger_transaction_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(title, category, optionalString(body, "branchId") ?? existing.branch_id ?? null, amount, occurredAt, status, body.description === null ? null : optionalString(body, "description", 1000) ?? existing.description ?? null, ledgerId, id),
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
  const existing = await env.DB.prepare("SELECT id, revision, amount, title, ledger_transaction_id AS ledgerId FROM expenses WHERE id = ?").bind(id).first<{ id: string; revision: number; amount: number; title: string; ledgerId: string | null }>();
  if (!existing) return notFound("Операция не найдена");
  const voided = await env.DB.prepare("SELECT id FROM financial_transactions WHERE expense_id = ? AND status = 'VOIDED' LIMIT 1").bind(id).first();
  if (voided) return json({ ok: true, replayed: true });
  await env.DB.batch([
    ...assertUnchanged(env.DB, "expenses", String(id), existing.revision),
    env.DB.prepare("UPDATE financial_transactions SET status = 'VOIDED' WHERE expense_id = ?").bind(id),
    env.DB.prepare("UPDATE expenses SET status = 'PLANNED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id),
    auditStatement(env.DB, user, "expense", id, "VOID", { title: existing.title, amount: existing.amount }, { ledgerId: existing.ledgerId, status: "VOIDED" }),
  ]);
  return json({ ok: true });
};
