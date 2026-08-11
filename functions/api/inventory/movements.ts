import { auditStatement } from "../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import { inventorySummary, stockBalanceExpression } from "../../_lib/inventory";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, conflict, dateValue, json, newId, optionalString, readJson, stringValue } from "../../_lib/http";
import { nonNegativeNumber } from "../../_lib/validation";

const movementTypes = new Set(["PURCHASE", "SERVICE_USAGE", "MANUAL_IN", "MANUAL_OUT", "SALE", "RETURN", "WRITE_OFF", "CORRECTION"]);

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "inventory.read")) return forbidden();
  const params = new URL(request.url).searchParams;
  const filters = ["1 = 1"];
  const bindings: string[] = [];
  if (params.get("branchId")) { filters.push("sm.branch_id = ?"); bindings.push(params.get("branchId") as string); }
  if (params.get("productId")) { filters.push("sm.product_id = ?"); bindings.push(params.get("productId") as string); }
  if (params.get("from")) { filters.push("sm.occurred_at >= ?"); bindings.push(params.get("from") as string); }
  if (params.get("to")) { filters.push("sm.occurred_at <= ?"); bindings.push(params.get("to") as string); }
  const rows = await env.DB.prepare(`SELECT sm.id, sm.product_id AS productId, p.name AS productName, p.sku, sm.branch_id AS branchId, b.name AS branchName, sm.movement_type AS movementType, sm.direction, sm.quantity, sm.unit_price AS unitPrice, sm.total_cost AS totalCost, sm.occurred_at AS occurredAt, sm.source, sm.appointment_id AS appointmentId, sm.purchase_id AS purchaseId, sm.comment, u.name AS userName FROM stock_movements sm INNER JOIN products p ON p.id = sm.product_id LEFT JOIN branches b ON b.id = sm.branch_id LEFT JOIN users u ON u.id = sm.user_id WHERE ${filters.join(" AND ")} ORDER BY sm.occurred_at DESC LIMIT 500`).bind(...bindings).all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "inventory.write")) return forbidden();
  const body = await readJson(request);
  const productId = stringValue(body, "productId");
  const branchId = stringValue(body, "branchId");
  const movementType = stringValue(body, "movementType", "CORRECTION").toUpperCase();
  const quantity = nonNegativeNumber(body.quantity, "Количество");
  const unitPrice = nonNegativeNumber(body.unitPrice, "Цена");
  const direction = stringValue(body, "direction", movementType === "MANUAL_OUT" || movementType === "WRITE_OFF" || movementType === "SERVICE_USAGE" || movementType === "SALE" ? "OUT" : "IN").toUpperCase();
  if (!productId || !branchId || !movementTypes.has(movementType) || !["IN", "OUT"].includes(direction) || quantity === null || quantity <= 0 || unitPrice === null) return badRequest("Проверьте товар, филиал, тип, направление и количество");
  const product = await env.DB.prepare("SELECT id, name FROM products WHERE id = ? AND is_active = 1").bind(productId).first<{ id: string; name: string }>();
  if (!product) return badRequest("Товар не найден или архивирован");
  if (!await env.DB.prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1").bind(branchId).first()) return badRequest("Филиал не найден");
  if (direction === "OUT") {
    const balance = await env.DB.prepare(`SELECT ${stockBalanceExpression()} AS value FROM stock_movements sm WHERE sm.product_id = ? AND sm.branch_id = ?`).bind(productId, branchId).first<{ value: number }>();
    if (Number(balance?.value ?? 0) + 0.000001 < quantity) return conflict(`Недостаточно товара «${product.name}». Доступно: ${Math.max(0, Number(balance?.value ?? 0))}`);
  }
  const idempotencyKey = optionalString(body, "idempotencyKey") || `manual:${newId()}`;
  const previous = await env.DB.prepare("SELECT id, product_id AS productId, quantity, direction FROM stock_movements WHERE idempotency_key = ? LIMIT 1").bind(idempotencyKey).first<{ id: string; productId: string; quantity: number; direction: string }>();
  if (previous) return json({ ok: true, id: previous.id, replayed: true });
  const id = newId();
  const totalCost = quantity * unitPrice;
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO stock_movements (id, product_id, branch_id, movement_type, direction, quantity, unit_price, total_cost, occurred_at, user_id, source, idempotency_key, comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, productId, branchId, movementType, direction, quantity, unitPrice, totalCost, dateValue(body, "occurredAt") || new Date().toISOString(), user.id, optionalString(body, "source") || "MANUAL", idempotencyKey, optionalString(body, "comment")),
      auditStatement(env.DB, user, "stock_movement", id, "CREATE", null, { productId, branchId, movementType, direction, quantity, totalCost }),
    ]);
  } catch (error) {
    if (/unique/i.test(error instanceof Error ? error.message : "")) return json({ ok: true, id, replayed: true });
    return json({ ok: false, error: "Не удалось сохранить движение склада" }, 500);
  }
  return json({ ok: true, id, currentStock: (await inventorySummary(env.DB, branchId)).find((item) => (item as Record<string, unknown>).id === productId)?.currentStock ?? null }, 201);
};
