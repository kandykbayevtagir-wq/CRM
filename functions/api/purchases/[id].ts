import { auditStatement } from "../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, json, notFound, optionalString, readJson, stringValue } from "../../_lib/http";
import { nonNegativeNumber } from "../../_lib/validation";

const paymentMethods = new Set(["CASH", "CARD", "TRANSFER", "OTHER"]);
// Receipt is driven by stock movements; the manual status machine must not undo received stock.
const transitions: Record<string, string[]> = { DRAFT: ["DRAFT", "ORDERED", "CANCELLED"], ORDERED: ["ORDERED", "DRAFT", "CANCELLED"], PARTIALLY_RECEIVED: ["PARTIALLY_RECEIVED"], RECEIVED: ["RECEIVED"], CANCELLED: ["CANCELLED"] };

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "purchases.read")) return forbidden();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [purchase, items] = await Promise.all([
    env.DB.prepare("SELECT p.id, p.supplier_id AS supplierId, s.name AS supplierName, p.branch_id AS branchId, b.name AS branchName, p.order_date AS orderDate, p.delivery_date AS deliveryDate, p.status, p.total_amount AS totalAmount, p.paid_amount AS paidAmount, p.payment_method AS paymentMethod, p.comment FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id INNER JOIN branches b ON b.id = p.branch_id WHERE p.id = ?").bind(id).first(),
    env.DB.prepare("SELECT pi.id, pi.product_id AS productId, p.name AS productName, p.sku, p.unit, pi.ordered_quantity AS orderedQuantity, pi.received_quantity AS receivedQuantity, pi.unit_cost AS unitCost FROM purchase_items pi INNER JOIN products p ON p.id = pi.product_id WHERE pi.purchase_id = ? ORDER BY p.name").bind(id).all(),
  ]);
  if (!purchase) return notFound("Закупка не найдена");
  return json({ ok: true, purchase, items: items.results ?? [] });
};

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "purchases.write")) return forbidden();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const existing = await env.DB.prepare("SELECT id, status, comment, payment_method AS paymentMethod, paid_amount AS paidAmount FROM purchases WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!existing) return notFound("Закупка не найдена");
  const body = await readJson(request);
  const currentStatus = String(existing.status ?? "DRAFT");
  const status = stringValue(body, "status", currentStatus).toUpperCase();
  if (!["DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"].includes(status)) return badRequest("Некорректный статус закупки");
  if (!(transitions[currentStatus] ?? []).includes(status)) return badRequest(currentStatus === "CANCELLED" ? "Отменённую закупку нельзя изменить" : "Статус приёмки меняется только через приём товара");
  const paidAmount = nonNegativeNumber(body.paidAmount ?? existing.paidAmount ?? 0, "Оплачено");
  if (paidAmount === null) return badRequest("Оплаченная сумма должна быть неотрицательным числом");
  const paymentMethodRaw = optionalString(body, "paymentMethod");
  const paymentMethod = paymentMethodRaw === null ? (existing.paymentMethod as string | null) ?? null : paymentMethodRaw.toUpperCase();
  if (paymentMethod && !paymentMethods.has(paymentMethod)) return badRequest("Некорректный способ оплаты закупки");
  await env.DB.batch([
    env.DB.prepare("UPDATE purchases SET status = ?, paid_amount = ?, payment_method = ?, comment = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(status, paidAmount, paymentMethod, optionalString(body, "comment", 1000) ?? existing.comment ?? null, id),
    auditStatement(env.DB, user, "purchase", id, "UPDATE", { status: existing.status }, { status }),
  ]);
  return json({ ok: true });
};
