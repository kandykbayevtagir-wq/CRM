import { auditStatement } from "../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, dateValue, json, newId, optionalString, readJson, stringValue } from "../_lib/http";
import { nonNegativeNumber } from "../_lib/validation";

const statuses = new Set(["PLANNED", "DUE", "PAID", "OVERDUE"]);

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "finance.read")) return forbidden();
  const branchId = new URL(request.url).searchParams.get("branchId")?.trim() ?? "";
  const rows = await env.DB.prepare(`SELECT r.id, r.branch_id AS branchId, b.name AS branchName, r.period_start AS periodStart, r.amount, r.due_date AS dueDate, r.status, r.paid_at AS paidAt, r.note FROM rent_payments r LEFT JOIN branches b ON b.id = r.branch_id${branchId ? " WHERE r.branch_id = ?" : ""} ORDER BY r.due_date ASC LIMIT 200`).bind(...(branchId ? [branchId] : [])).all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "finance.write")) return forbidden();
  const body = await readJson(request);
  const branchId = stringValue(body, "branchId");
  const periodStart = dateValue(body, "periodStart");
  const dueDate = dateValue(body, "dueDate");
  const amount = nonNegativeNumber(body.amount, "Сумма");
  const statusValue = stringValue(body, "status", "PLANNED").toUpperCase();
  const status = statuses.has(statusValue) ? statusValue : "PLANNED";
  if (!branchId || !periodStart || !dueDate || amount === null || amount <= 0) return badRequest("Филиал, период, срок и положительная сумма обязательны");
  const branch = await env.DB.prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1").bind(branchId).first();
  if (!branch) return badRequest("Филиал не найден");
  const id = newId();
  const ledgerId = status === "PAID" ? newId() : null;
  const paidAt = status === "PAID" ? dateValue(body, "paidAt") || new Date().toISOString() : null;
  const statements: D1PreparedStatement[] = [env.DB.prepare("INSERT INTO rent_payments (id, branch_id, period_start, amount, due_date, status, paid_at, note, ledger_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, branchId, periodStart, amount, dueDate, status, paidAt, optionalString(body, "note"), ledgerId)];
  if (ledgerId) statements.push(env.DB.prepare("INSERT INTO financial_transactions (id, direction, kind, category, amount, status, occurred_at, branch_id, rent_payment_id, description, created_by) VALUES (?, 'EXPENSE', 'RENT', 'RENT', ?, 'POSTED', ?, ?, ?, ?, ?)").bind(ledgerId, amount, paidAt, branchId, id, optionalString(body, "note") ?? "Аренда", user.id));
  statements.push(auditStatement(env.DB, user, "rent_payment", id, "CREATE", null, { branchId, periodStart, amount, dueDate, status }));
  await env.DB.batch(statements);
  return json({ ok: true, id }, 201);
};
