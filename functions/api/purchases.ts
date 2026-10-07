import Decimal from "decimal.js";

import { auditStatement } from "../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, json, newId, optionalString, readJson, stringValue } from "../_lib/http";
import { isoColumn, organizationTimezone, zonedDateValue } from "../_lib/dates";
import { nonNegativeNumber } from "../_lib/validation";

type PurchaseItemInput = { productId: string; quantity: number; unitCost: number };

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "purchases.read")) return forbidden();
  const params = new URL(request.url).searchParams;
  const filters = ["1 = 1"];
  const bindings: string[] = [];
  if (params.get("branchId")) { filters.push("p.branch_id = ?"); bindings.push(params.get("branchId") as string); }
  if (params.get("status")) { filters.push("p.status = ?"); bindings.push(params.get("status") as string); }
  const rows = await env.DB.prepare(`SELECT p.id, p.supplier_id AS supplierId, s.name AS supplierName, p.branch_id AS branchId, b.name AS branchName, ${isoColumn("p.order_date")} AS orderDate, ${isoColumn("p.delivery_date")} AS deliveryDate, p.status, p.total_amount AS totalAmount, p.paid_amount AS paidAmount, p.payment_method AS paymentMethod, p.comment, (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS itemCount FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id INNER JOIN branches b ON b.id = p.branch_id WHERE ${filters.join(" AND ")} ORDER BY julianday(p.order_date) DESC LIMIT 300`).bind(...bindings).all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "purchases.write")) return forbidden();
  const body = await readJson(request);
  const branchId = stringValue(body, "branchId");
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items: PurchaseItemInput[] = rawItems.map((value): PurchaseItemInput | null => {
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    const quantity = nonNegativeNumber(item.quantity, "Количество");
    const unitCost = nonNegativeNumber(item.unitCost, "Цена");
    return typeof item.productId === "string" && quantity !== null && quantity > 0 && unitCost !== null ? { productId: item.productId.trim(), quantity, unitCost } : null;
  }).filter((item): item is PurchaseItemInput => item !== null);
  if (!branchId || !items.length) return badRequest("Укажите филиал и хотя бы одну позицию");
  if (items.length > 50) return badRequest("В одной закупке не более 50 позиций");
  if (!await env.DB.prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1").bind(branchId).first()) return badRequest("Филиал не найден");
  const timezone = await organizationTimezone(env.DB);
  const supplierId = optionalString(body, "supplierId") || null;
  if (supplierId && !await env.DB.prepare("SELECT id FROM suppliers WHERE id = ? AND is_active = 1").bind(supplierId).first()) return badRequest("Поставщик не найден");
  const placeholders = items.map(() => "?").join(",");
  const products = await env.DB.prepare(`SELECT id FROM products WHERE id IN (${placeholders}) AND is_active = 1`).bind(...items.map((item) => item.productId)).all<{ id: string }>();
  if ((products.results ?? []).length !== new Set(items.map((item) => item.productId)).size) return badRequest("Одна из позиций не найдена или архивирована");
  const total = items.reduce((sum, item) => sum.plus(new Decimal(item.quantity).mul(item.unitCost)), new Decimal(0));
  const id = newId();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO purchases (id, supplier_id, branch_id, order_date, delivery_date, status, total_amount, paid_amount, payment_method, comment, created_by) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?)")
      .bind(id, optionalString(body, "supplierId"), branchId, zonedDateValue(body, "orderDate", timezone) || new Date().toISOString(), zonedDateValue(body, "deliveryDate", timezone) || null, total.toNumber(), nonNegativeNumber(body.paidAmount, "Оплачено") ?? 0, optionalString(body, "paymentMethod", 20), optionalString(body, "comment", 1000), user.id),
  ];
  for (const item of items) statements.push(env.DB.prepare("INSERT INTO purchase_items (id, purchase_id, product_id, ordered_quantity, unit_cost) VALUES (?, ?, ?, ?, ?)").bind(newId(), id, item.productId, item.quantity, item.unitCost));
  statements.push(auditStatement(env.DB, user, "purchase", id, "CREATE", null, { branchId, supplierId: optionalString(body, "supplierId"), items, totalAmount: total.toFixed(2) }));
  await env.DB.batch(statements);
  return json({ ok: true, id, totalAmount: total.toFixed(2) }, 201);
};
