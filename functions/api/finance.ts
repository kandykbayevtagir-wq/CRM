import { auditStatement } from "../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, boundedString, escapeLike, json, LIKE_ESCAPE, newId, optionalString, readJson, stringValue } from "../_lib/http";
import { isoColumn, normalizeIso, organizationTimezone, zonedDateValue } from "../_lib/dates";
import { nonNegativeMoney } from "../_lib/validation";
import { mutationReceipt } from "../_lib/mutation-receipt";

const categories = new Set(["RENT", "UTILITIES", "SALARY", "SUPPLIES", "MARKETING", "TAX", "EQUIPMENT", "OTHER"]);

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "finance.read")) return forbidden();
  const params = new URL(request.url).searchParams;
  const query = (params.get("q")?.trim() ?? "").slice(0, 100);
  const from = normalizeIso(params.get("from")?.trim() ?? "");
  const to = normalizeIso(params.get("to")?.trim() ?? "");
  const filters = ["x.status <> 'VOIDED'"];
  const bindings: string[] = [];
  if (query) { filters.push(`(x.description LIKE ? ${LIKE_ESCAPE} OR x.category LIKE ? ${LIKE_ESCAPE} OR x.kind LIKE ? ${LIKE_ESCAPE})`); bindings.push(`%${escapeLike(query)}%`, `%${escapeLike(query)}%`, `%${escapeLike(query)}%`); }
  if (from) { filters.push("julianday(x.occurred_at) >= julianday(?)"); bindings.push(from); }
  if (to) { filters.push("julianday(x.occurred_at) <= julianday(?)"); bindings.push(to); }
  const branchId = params.get("branchId")?.trim();
  if (branchId) { filters.push("x.branch_id = ?"); bindings.push(branchId); }
  const result = await env.DB.prepare(`
    SELECT x.id,
      CASE x.kind WHEN 'PAYMENT' THEN 'Оплата приёма' WHEN 'REFUND' THEN 'Возврат оплаты' WHEN 'RENT' THEN 'Аренда' WHEN 'UTILITIES' THEN 'Коммунальные услуги' ELSE COALESCE(x.description, 'Финансовая операция') END AS title,
      x.category, x.branch_id AS branchId, b.name AS branchName, x.amount, ${isoColumn("x.occurred_at")} AS occurredAt,
      CASE WHEN x.status = 'POSTED' AND x.direction = 'INCOME' THEN 'PAID' WHEN x.status = 'PLANNED' THEN 'PLANNED' ELSE x.status END AS status,
      x.description, x.direction, x.kind, x.appointment_id AS appointmentId, x.expense_id AS expenseId
    FROM financial_transactions x LEFT JOIN branches b ON b.id = x.branch_id
    WHERE ${filters.join(" AND ")} ORDER BY julianday(x.occurred_at) DESC LIMIT 300
  `).bind(...bindings).all();
  return json({ ok: true, items: result.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "finance.write")) return forbidden();
  const body = await readJson(request);
  const receipt = await mutationReceipt(env.DB, user.id, "expense:create", body);
  if (receipt.replay) return receipt.replay;
  const title = boundedString(body, "title", 200);
  const categoryValue = stringValue(body, "category", "OTHER").toUpperCase();
  const category = categories.has(categoryValue) ? categoryValue : "OTHER";
  const amount = nonNegativeMoney(body.amount, "Сумма");
  const occurredAt = zonedDateValue(body, "occurredAt", await organizationTimezone(env.DB)) || new Date().toISOString();
  const branchId = optionalString(body, "branchId") || null;
  if (branchId && !await env.DB.prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1").bind(branchId).first()) return badRequest("Филиал не найден");
  if (!title || amount === null || amount <= 0) return badRequest("Название и положительная сумма расхода обязательны");
  const status = stringValue(body, "status", "PAID").toUpperCase() === "PLANNED" ? "PLANNED" : "PAID";
  const id = newId();
  const ledgerId = newId();
  return receipt.commit([
    env.DB.prepare("INSERT INTO expenses (id, title, category, branch_id, amount, occurred_at, status, description, created_by, ledger_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, title, category, branchId, amount, occurredAt, status, optionalString(body, "description", 1000), user.id, ledgerId),
    env.DB.prepare("INSERT INTO financial_transactions (id, direction, kind, category, amount, status, occurred_at, branch_id, expense_id, description, created_by) VALUES (?, 'EXPENSE', 'EXPENSE', ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(ledgerId, category, amount, status === "PAID" ? "POSTED" : "PLANNED", occurredAt, branchId, id, title, user.id),
    auditStatement(env.DB, user, "expense", id, "CREATE", null, { title, category, amount, status }),
  ], { ok: true, id });
};
