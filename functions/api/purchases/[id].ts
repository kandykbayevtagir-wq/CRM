import { auditStatement } from "../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, json, notFound, optionalString, readJson, stringValue } from "../../_lib/http";

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
  const status = stringValue(body, "status", String(existing.status ?? "DRAFT")).toUpperCase();
  if (!["DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"].includes(status)) return badRequest("Некорректный статус закупки");
  if (status === "RECEIVED") {
    const pending = await env.DB.prepare("SELECT COUNT(*) AS count FROM purchase_items WHERE purchase_id = ? AND received_quantity < ordered_quantity").bind(id).first<{ count: number }>();
    if (Number(pending?.count ?? 0) > 0) return badRequest("Сначала примите все позиции полностью или используйте частичную поставку");
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE purchases SET status = ?, paid_amount = ?, payment_method = ?, comment = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(status, Number(body.paidAmount ?? existing.paidAmount ?? 0), optionalString(body, "paymentMethod") ?? existing.paymentMethod ?? null, optionalString(body, "comment") ?? existing.comment ?? null, id),
    auditStatement(env.DB, user, "purchase", id, "UPDATE", { status: existing.status }, { status }),
  ]);
  return json({ ok: true });
};
