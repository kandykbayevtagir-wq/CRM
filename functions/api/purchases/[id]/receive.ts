import Decimal from "decimal.js";

import { auditStatement } from "../../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../../_lib/auth";
import type { CrmEnv } from "../../../_lib/env";
import { badRequest, dateValue, json, newId, readJson, stringValue } from "../../../_lib/http";
import { nonNegativeNumber } from "../../../_lib/validation";

type ReceiveItem = { purchaseItemId: string; quantity: number; unitCost?: number };

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "purchases.write")) return forbidden();
  const purchaseId = Array.isArray(params.id) ? params.id[0] : params.id;
  const purchase = await env.DB.prepare("SELECT id, branch_id AS branchId, status FROM purchases WHERE id = ?").bind(purchaseId).first<{ id: string; branchId: string; status: string }>();
  if (!purchase || purchase.status === "CANCELLED") return badRequest("Закупка не найдена или отменена");
  const body = await readJson(request);
  const items = (Array.isArray(body.items) ? body.items : []).map((raw): ReceiveItem | null => {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const quantity = nonNegativeNumber(item.quantity, "Количество");
    const unitCost = item.unitCost === undefined ? undefined : nonNegativeNumber(item.unitCost, "Цена");
    return typeof item.purchaseItemId === "string" && quantity !== null && quantity > 0 && (item.unitCost === undefined || unitCost !== null) ? { purchaseItemId: item.purchaseItemId, quantity, ...(unitCost === undefined || unitCost === null ? {} : { unitCost }) } : null;
  }).filter((item): item is ReceiveItem => item !== null);
  if (!items.length) return badRequest("Укажите хотя бы одну принимаемую позицию");
  const key = stringValue(body, "idempotencyKey") || newId();
  const statements: D1PreparedStatement[] = [];
  const requestedMovementKeys: string[] = [];
  for (const item of items) {
    const row = await env.DB.prepare("SELECT pi.id, pi.product_id AS productId, pi.ordered_quantity AS orderedQuantity, pi.received_quantity AS receivedQuantity, pi.unit_cost AS unitCost, p.name, p.purchase_price AS purchasePrice FROM purchase_items pi INNER JOIN products p ON p.id = pi.product_id WHERE pi.id = ? AND pi.purchase_id = ?").bind(item.purchaseItemId, purchaseId).first<{ id: string; productId: string; orderedQuantity: number; receivedQuantity: number; unitCost: number; name: string; purchasePrice: number }>();
    if (!row) return badRequest("Позиция закупки не найдена");
    const remaining = Number(row.orderedQuantity) - Number(row.receivedQuantity);
    if (item.quantity > remaining + 0.000001) return badRequest(`Количество для «${row.name}» превышает остаток к приёму`);
    const unitCost = item.unitCost ?? Number(row.unitCost ?? row.purchasePrice ?? 0);
    const movementKey = `purchase:${purchaseId}:item:${item.purchaseItemId}:receipt:${key}`;
    const existingMovement = await env.DB.prepare("SELECT id FROM stock_movements WHERE idempotency_key = ? LIMIT 1").bind(movementKey).first<{ id: string }>();
    if (existingMovement) continue;
    requestedMovementKeys.push(movementKey);
    const movementId = newId();
    const totalCost = new Decimal(item.quantity).mul(unitCost).toNumber();
    statements.push(
      // Both statements use the same conditional remaining quantity. D1 runs
      // the batch atomically, so concurrent receipts cannot create stock first
      // and then over-increment the purchase item.
      env.DB.prepare(`INSERT INTO stock_movements (id, product_id, branch_id, movement_type, direction, quantity, unit_price, total_cost, occurred_at, user_id, source, purchase_id, purchase_item_id, idempotency_key, comment)
        SELECT ?, ?, ?, 'PURCHASE', 'IN', ?, ?, ?, ?, ?, 'PURCHASE_RECEIPT', ?, ?, ?, ?
        FROM purchase_items pi
        WHERE pi.id = ? AND pi.purchase_id = ? AND pi.received_quantity + ? <= pi.ordered_quantity`)
        .bind(movementId, row.productId, purchase.branchId, item.quantity, unitCost, totalCost, dateValue(body, "receivedAt") || new Date().toISOString(), user.id, purchaseId, item.purchaseItemId, movementKey, `Приёмка закупки ${purchaseId}`, item.purchaseItemId, purchaseId, item.quantity),
      env.DB.prepare("UPDATE purchase_items SET received_quantity = received_quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND purchase_id = ? AND received_quantity + ? <= ordered_quantity")
        .bind(item.quantity, item.purchaseItemId, purchaseId, item.quantity),
      env.DB.prepare("UPDATE products SET purchase_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND EXISTS (SELECT 1 FROM stock_movements WHERE id = ?)")
        .bind(unitCost, row.productId, movementId),
    );
  }
  if (!statements.length) return json({ ok: true, replayed: true });
  statements.push(env.DB.prepare(`UPDATE purchases SET status = CASE WHEN (SELECT COUNT(*) FROM purchase_items WHERE purchase_id = ? AND received_quantity < ordered_quantity) = 0 THEN 'RECEIVED' ELSE 'PARTIALLY_RECEIVED' END, delivery_date = COALESCE(delivery_date, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(purchaseId, purchaseId));
  statements.push(auditStatement(env.DB, user, "purchase", purchaseId, "RECEIVE", null, { items }));
  try {
    await env.DB.batch(statements);
  } catch (cause) {
    if (/unique|constraint/i.test(cause instanceof Error ? cause.message : "") && requestedMovementKeys.length) {
      const placeholders = requestedMovementKeys.map(() => "?").join(",");
      const replay = await env.DB.prepare(`SELECT COUNT(*) AS value FROM stock_movements WHERE idempotency_key IN (${placeholders})`).bind(...requestedMovementKeys).first<{ value: number }>();
      if (Number(replay?.value ?? 0) === requestedMovementKeys.length) return json({ ok: true, replayed: true });
    }
    return json({ ok: false, error: "Не удалось принять закупку. Проверьте остаток к приёму и повторите." }, 409);
  }
  return json({ ok: true, received: items });
};
