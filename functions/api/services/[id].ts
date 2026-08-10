import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { json, newId, notFound, numberValue, readJson, stringValue } from "../../_lib/http";

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "services.write")) return forbidden();
  const existing = await env.DB.prepare("SELECT * FROM services WHERE id = ?").bind(params.id).first();
  if (!existing) return notFound("Услуга не найдена");
  const body = await readJson(request);
  const price = numberValue(body, "price", Number(existing.price ?? 0));
  const durationMinutes = numberValue(body, "durationMinutes", Number(existing.duration_minutes ?? 60));
  const cost = numberValue(body, "cost", Number(existing.cost ?? 0));
  if (price < 0 || cost < 0 || durationMinutes < 15 || durationMinutes > 720) return json({ ok: false, error: "Проверьте стоимость и длительность услуги" }, 400);
  await env.DB.prepare(`
    UPDATE services SET name = ?, category = ?, price = ?, duration_minutes = ?, cost = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(
    stringValue(body, "name", String(existing.name ?? "")),
    stringValue(body, "category", String(existing.category ?? "Подология")),
    price,
    Math.max(15, durationMinutes),
    cost,
    numberValue(body, "isActive", Number(existing.is_active ?? 1)) ? 1 : 0,
    params.id,
  ).run();
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action) VALUES (?, ?, 'service', ?, 'UPDATE')")
    .bind(newId(), user.id, params.id).run();
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "services.write")) return forbidden();
  const result = await env.DB.prepare("UPDATE services SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(params.id).run();
  if (!result.success || result.meta.changes === 0) return notFound("Услуга не найдена");
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action) VALUES (?, ?, 'service', ?, 'ARCHIVE')")
    .bind(newId(), user.id, params.id).run();
  return json({ ok: true });
};
