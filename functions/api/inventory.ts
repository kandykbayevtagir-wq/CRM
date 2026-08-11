import { auditStatement } from "../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import { inventorySummary } from "../_lib/inventory";
import type { CrmEnv } from "../_lib/env";
import { badRequest, json, newId, optionalString, readJson, stringValue } from "../_lib/http";
import { nonNegativeNumber } from "../_lib/validation";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "inventory.read")) return forbidden();
  const params = new URL(request.url).searchParams;
  const branchId = params.get("branchId")?.trim() || null;
  const items = await inventorySummary(env.DB, branchId);
  const category = params.get("category")?.trim();
  const supplier = params.get("supplier")?.trim();
  const query = params.get("q")?.trim().toLowerCase();
  const filtered = items.filter((item) => {
    const row = item as Record<string, unknown>;
    if (category && row.categoryName !== category) return false;
    if (supplier && row.supplierName !== supplier) return false;
    if (query && !`${row.name ?? ""} ${row.sku ?? ""}`.toLowerCase().includes(query)) return false;
    if (params.get("lowStock") === "1" && Number(row.lowStock) !== 1) return false;
    return true;
  });
  return json({ ok: true, items: filtered });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "inventory.write")) return forbidden();
  const body = await readJson(request);
  const name = stringValue(body, "name");
  const sku = stringValue(body, "sku").toUpperCase();
  const unit = stringValue(body, "unit", "шт");
  const purchasePrice = nonNegativeNumber(body.purchasePrice, "Закупочная цена");
  const salePrice = nonNegativeNumber(body.salePrice, "Цена продажи");
  const minStock = nonNegativeNumber(body.minStock, "Минимальный остаток");
  const optimalStock = nonNegativeNumber(body.optimalStock, "Оптимальный остаток");
  if (!name || !sku || purchasePrice === null || salePrice === null || minStock === null || optimalStock === null) return badRequest("Заполните название, SKU и корректные числовые значения");
  if (optimalStock < minStock) return badRequest("Оптимальный остаток не может быть меньше минимального");
  const branchId = optionalString(body, "branchId");
  if (branchId && !await env.DB.prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1").bind(branchId).first()) return badRequest("Филиал не найден");
  const id = newId();
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO products
        (id, name, sku, category_id, unit, purchase_price, sale_price, min_stock, optimal_stock, supplier_id, branch_id, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, name, sku, optionalString(body, "categoryId"), unit, purchasePrice, salePrice, minStock, optimalStock, optionalString(body, "supplierId"), branchId, optionalString(body, "notes"), user.id),
      auditStatement(env.DB, user, "product", id, "CREATE", null, { name, sku, branchId, purchasePrice, minStock, optimalStock }),
    ]);
  } catch (error) {
    if (/unique/i.test(error instanceof Error ? error.message : "")) return badRequest("SKU уже используется");
    return json({ ok: false, error: "Не удалось создать товар" }, 500);
  }
  return json({ ok: true, id }, 201);
};
