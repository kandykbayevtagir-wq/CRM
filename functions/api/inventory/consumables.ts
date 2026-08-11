import { auditStatement } from "../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, json, newId, optionalString, readJson, stringValue } from "../../_lib/http";
import { nonNegativeNumber } from "../../_lib/validation";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "inventory.read")) return forbidden();
  const serviceId = new URL(request.url).searchParams.get("serviceId")?.trim();
  const rows = await env.DB.prepare(`SELECT sc.id, sc.service_id AS serviceId, sc.product_id AS productId, p.name AS productName, p.unit, sc.branch_id AS branchId, b.name AS branchName, sc.quantity, sc.active FROM service_consumables sc INNER JOIN products p ON p.id = sc.product_id LEFT JOIN branches b ON b.id = sc.branch_id ${serviceId ? "WHERE sc.service_id = ?" : "WHERE sc.active = 1"} ORDER BY p.name`).bind(...(serviceId ? [serviceId] : [])).all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "inventory.write")) return forbidden();
  const body = await readJson(request);
  const serviceId = stringValue(body, "serviceId");
  const productId = stringValue(body, "productId");
  const quantity = nonNegativeNumber(body.quantity, "Количество");
  if (!serviceId || !productId || quantity === null || quantity <= 0) return badRequest("Укажите услугу, товар и положительное количество");
  if (!await env.DB.prepare("SELECT id FROM services WHERE id = ? AND is_active = 1").bind(serviceId).first()) return badRequest("Услуга не найдена");
  if (!await env.DB.prepare("SELECT id FROM products WHERE id = ? AND is_active = 1").bind(productId).first()) return badRequest("Товар не найден");
  const id = newId();
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO service_consumables (id, service_id, product_id, branch_id, quantity) VALUES (?, ?, ?, ?, ?)").bind(id, serviceId, productId, optionalString(body, "branchId"), quantity),
      auditStatement(env.DB, user, "service_consumable", id, "CREATE", null, { serviceId, productId, quantity, branchId: optionalString(body, "branchId") }),
    ]);
  } catch (error) {
    if (/unique/i.test(error instanceof Error ? error.message : "")) return badRequest("Такой расходник уже привязан к услуге");
    return json({ ok: false, error: "Не удалось привязать расходник" }, 500);
  }
  return json({ ok: true, id }, 201);
};
