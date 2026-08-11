import { auditStatement } from "../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, json, readJson, stringValue } from "../../_lib/http";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "inventory.read")) return forbidden();
  const status = new URL(request.url).searchParams.get("status")?.trim().toUpperCase() || "OPEN";
  const rows = await env.DB.prepare(`SELECT ii.id, ii.appointment_id AS appointmentId, ii.service_id AS serviceId, s.name AS serviceName, ii.product_id AS productId, p.name AS productName, ii.required_quantity AS requiredQuantity, ii.available_quantity AS availableQuantity, ii.status, ii.message, ii.created_at AS createdAt, ii.resolved_at AS resolvedAt FROM inventory_issues ii INNER JOIN services s ON s.id = ii.service_id INNER JOIN products p ON p.id = ii.product_id WHERE ii.status = ? ORDER BY ii.created_at DESC LIMIT 200`).bind(status).all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "inventory.write")) return forbidden();
  const body = await readJson(request);
  const id = stringValue(body, "id");
  const status = stringValue(body, "status", "RESOLVED").toUpperCase();
  if (!id || !["RESOLVED", "IGNORED"].includes(status)) return badRequest("Укажите проблему и корректный статус");
  const result = await env.DB.prepare("UPDATE inventory_issues SET status = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'OPEN'").bind(status, id).run();
  if (!result.meta.changes) return badRequest("Проблема уже обработана или не найдена");
  await env.DB.batch([auditStatement(env.DB, user, "inventory_issue", id, "UPDATE", { status: "OPEN" }, { status })]);
  return json({ ok: true });
};
