import { auditStatement } from "../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, json, notFound, optionalString, readJson, stringValue } from "../../_lib/http";
import { nonNegativeNumber } from "../../_lib/validation";

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "inventory.write")) return forbidden();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const existing = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!existing) return notFound("Товар не найден");
  const body = await readJson(request);
  const name = stringValue(body, "name", String(existing.name ?? ""));
  const sku = stringValue(body, "sku", String(existing.sku ?? "")).toUpperCase();
  const purchasePrice = nonNegativeNumber(body.purchasePrice ?? existing.purchase_price, "Закупочная цена");
  const salePrice = nonNegativeNumber(body.salePrice ?? existing.sale_price, "Цена продажи");
  const minStock = nonNegativeNumber(body.minStock ?? existing.min_stock, "Минимальный остаток");
  const optimalStock = nonNegativeNumber(body.optimalStock ?? existing.optimal_stock, "Оптимальный остаток");
  if (!name || !sku || purchasePrice === null || salePrice === null || minStock === null || optimalStock === null || optimalStock < minStock) return badRequest("Проверьте данные товара и остатки");
  const active = body.isActive === undefined ? Number(existing.is_active ?? 1) : body.isActive === false || body.isActive === "false" ? 0 : 1;
  try {
    await env.DB.batch([
      env.DB.prepare(`UPDATE products SET name = ?, sku = ?, category_id = ?, unit = ?, purchase_price = ?, sale_price = ?, min_stock = ?, optimal_stock = ?, supplier_id = ?, branch_id = ?, is_active = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(name, sku, optionalString(body, "categoryId") ?? existing.category_id ?? null, stringValue(body, "unit", String(existing.unit ?? "шт")), purchasePrice, salePrice, minStock, optimalStock, optionalString(body, "supplierId") ?? existing.supplier_id ?? null, optionalString(body, "branchId") ?? existing.branch_id ?? null, active, optionalString(body, "notes") ?? existing.notes ?? null, id),
      auditStatement(env.DB, user, "product", id, "UPDATE", { name: existing.name, sku: existing.sku, isActive: existing.is_active }, { name, sku, isActive: active }),
    ]);
  } catch (error) {
    if (/unique/i.test(error instanceof Error ? error.message : "")) return badRequest("SKU уже используется");
    return json({ ok: false, error: "Не удалось изменить товар" }, 500);
  }
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "inventory.write")) return forbidden();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const result = await env.DB.prepare("UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND is_active = 1").bind(id).run();
  if (!result.meta.changes) return notFound("Товар не найден");
  await env.DB.batch([auditStatement(env.DB, user, "product", id, "ARCHIVE", { isActive: 1 }, { isActive: 0 })]);
  return json({ ok: true });
};
