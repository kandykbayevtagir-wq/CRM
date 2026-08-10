import { auditStatement } from "../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, dateValue, json, newId, optionalString, readJson, stringValue } from "../_lib/http";
import { nonNegativeNumber } from "../_lib/validation";

const categories = new Set(["RENT", "UTILITIES", "SALARY", "SUPPLIES", "MARKETING", "TAX", "EQUIPMENT", "OTHER"]);

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "finance.read")) return forbidden();
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  const from = params.get("from")?.trim() ?? "";
  const to = params.get("to")?.trim() ?? "";
  const filters = ["x.status <> 'VOIDED'"];
  const bindings: string[] = [];
  if (query) { filters.push("(x.description LIKE ? OR x.category LIKE ? OR x.kind LIKE ?)"); bindings.push(`%${query}%`, `%${query}%`, `%${query}%`); }
  if (from) { filters.push("x.occurred_at >= ?"); bindings.push(from); }
  if (to) { filters.push("x.occurred_at <= ?"); bindings.push(to); }
  const branchId = params.get("branchId")?.trim();
  if (branchId) { filters.push("x.branch_id = ?"); bindings.push(branchId); }
  const result = await env.DB.prepare(`
    SELECT x.id,
      CASE x.kind WHEN 'PAYMENT' THEN 'Оплата приёма' WHEN 'REFUND' THEN 'Возврат оплаты' WHEN 'RENT' THEN 'Аренда' WHEN 'UTILITIES' THEN 'Коммунальные услуги' ELSE COALESCE(x.description, 'Финансовая операция') END AS title,
      x.category, x.branch_id AS branchId, b.name AS branchName, x.amount, x.occurred_at AS occurredAt,
      CASE WHEN x.status = 'POSTED' AND x.direction = 'INCOME' THEN 'PAID' WHEN x.status = 'PLANNED' THEN 'PLANNED' ELSE x.status END AS status,
      x.description, x.direction, x.kind, x.appointment_id AS appointmentId, x.expense_id AS expenseId
    FROM financial_transactions x LEFT JOIN branches b ON b.id = x.branch_id
    WHERE ${filters.join(" AND ")} ORDER BY x.occurred_at DESC LIMIT 300
  `).bind(...bindings).all();
  return json({ ok: true, items: result.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "finance.write")) return forbidden();
  const body = await readJson(request);
  const title = stringValue(body, "title");
  const categoryValue = stringValue(body, "category", "OTHER").toUpperCase();
  const category = categories.has(categoryValue) ? categoryValue : "OTHER";
  const amount = nonNegativeNumber(body.amount, "Сумма");
  const occurredAt = dateValue(body, "occurredAt") || new Date().toISOString();
  if (!title || amount === null || amount <= 0) return badRequest("Название и положительная сумма расхода обязательны");
  const status = stringValue(body, "status", "PAID").toUpperCase() === "PLANNED" ? "PLANNED" : "PAID";
  const id = newId();
  const ledgerId = newId();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO expenses (id, title, category, branch_id, amount, occurred_at, status, description, created_by, ledger_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, title, category, optionalString(body, "branchId"), amount, occurredAt, status, optionalString(body, "description"), user.id, ledgerId),
    env.DB.prepare("INSERT INTO financial_transactions (id, direction, kind, category, amount, status, occurred_at, branch_id, expense_id, description, created_by) VALUES (?, 'EXPENSE', 'EXPENSE', ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(ledgerId, category, amount, status === "PAID" ? "POSTED" : "PLANNED", occurredAt, optionalString(body, "branchId"), id, title, user.id),
    auditStatement(env.DB, user, "expense", id, "CREATE", null, { title, category, amount, status }),
  ]);
  return json({ ok: true, id }, 201);
};
