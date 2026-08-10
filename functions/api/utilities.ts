import { auditStatement } from "../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, dateValue, json, newId, optionalString, readJson, stringValue } from "../_lib/http";
import { utilityValues } from "../_lib/utility";

const statuses = new Set(["PLANNED", "DUE", "PAID", "OVERDUE"]);

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "finance.read")) return forbidden();
  const branchId = new URL(request.url).searchParams.get("branchId")?.trim() ?? "";
  const rows = await env.DB.prepare(`SELECT u.id, u.branch_id AS branchId, b.name AS branchName, u.kind, u.period_start AS periodStart, u.previous_meter_value AS previousMeterValue, u.current_meter_value AS currentMeterValue, u.consumption, u.tariff, u.fixed_fee AS fixedFee, u.amount, u.due_date AS dueDate, u.status, u.paid_at AS paidAt, u.note FROM utility_payments u LEFT JOIN branches b ON b.id = u.branch_id${branchId ? " WHERE u.branch_id = ?" : ""} ORDER BY u.due_date ASC LIMIT 300`).bind(...(branchId ? [branchId] : [])).all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "finance.write")) return forbidden();
  const body = await readJson(request);
  const branchId = stringValue(body, "branchId");
  const kind = stringValue(body, "kind", "OTHER");
  const periodStart = dateValue(body, "periodStart");
  const dueDate = dateValue(body, "dueDate");
  const statusValue = stringValue(body, "status", "PLANNED").toUpperCase();
  const status = statuses.has(statusValue) ? statusValue : "PLANNED";
  const values = utilityValues(body);
  if (!branchId || !kind || !periodStart || !dueDate || !values || values.amount <= 0) return badRequest("Проверьте филиал, период, показания и тариф");
  const branch = await env.DB.prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1").bind(branchId).first();
  if (!branch) return badRequest("Филиал не найден");
  const id = newId();
  const ledgerId = status === "PAID" ? newId() : null;
  const paidAt = status === "PAID" ? dateValue(body, "paidAt") || new Date().toISOString() : null;
  const statements: D1PreparedStatement[] = [env.DB.prepare("INSERT INTO utility_payments (id, branch_id, kind, period_start, previous_meter_value, current_meter_value, consumption, tariff, fixed_fee, amount, due_date, status, paid_at, note, ledger_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, branchId, kind, periodStart, values.previous, values.current, values.consumption, values.tariff, values.fixedFee, values.amount, dueDate, status, paidAt, optionalString(body, "note"), ledgerId)];
  if (ledgerId) statements.push(env.DB.prepare("INSERT INTO financial_transactions (id, direction, kind, category, amount, status, occurred_at, branch_id, utility_payment_id, description, created_by) VALUES (?, 'EXPENSE', 'UTILITIES', 'UTILITIES', ?, 'POSTED', ?, ?, ?, ?, ?)").bind(ledgerId, values.amount, paidAt, branchId, id, `${kind}: ${optionalString(body, "note") ?? "Коммунальный платёж"}`, user.id));
  statements.push(auditStatement(env.DB, user, "utility_payment", id, "CREATE", null, { branchId, kind, consumption: values.consumption, tariff: values.tariff, fixedFee: values.fixedFee, amount: values.amount, status }));
  await env.DB.batch(statements);
  return json({ ok: true, id, consumption: values.consumption, amount: values.amount }, 201);
};
