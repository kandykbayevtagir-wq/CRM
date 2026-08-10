import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, json, newId, numberValue, readJson, stringValue } from "../_lib/http";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "services.read")) return forbidden();
  const rows = await env.DB.prepare(`
    SELECT id, name, category, price, cost, duration_minutes AS durationMinutes, is_active AS isActive
    FROM services ORDER BY is_active DESC, category ASC, name ASC
  `).all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "services.write")) return forbidden();
  const body = await readJson(request);
  const name = stringValue(body, "name");
  const price = numberValue(body, "price");
  const cost = numberValue(body, "cost");
  const durationMinutes = numberValue(body, "durationMinutes", 60);
  if (!name || price < 0 || cost < 0 || durationMinutes < 15 || durationMinutes > 720) return badRequest("Проверьте название, стоимость и длительность услуги");
  const id = newId();
  await env.DB.prepare(`
    INSERT INTO services (id, name, category, price, duration_minutes, cost)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, name, stringValue(body, "category", "Подология"), price, Math.max(15, durationMinutes), cost).run();
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action, after_json) VALUES (?, ?, 'service', ?, 'CREATE', ?)")
    .bind(newId(), user.id, id, JSON.stringify({ name })).run();
  return json({ ok: true, id }, 201);
};
