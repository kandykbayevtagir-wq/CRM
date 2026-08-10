import { forbidden, getSessionUser, isStaff, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, json, newId, numberValue, readJson, stringValue } from "../_lib/http";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isStaff(user)) return forbidden();
  const rows = await env.DB.prepare(`
    SELECT id, name, category, price, duration_minutes AS durationMinutes, is_active AS isActive
    FROM services ORDER BY is_active DESC, category ASC, name ASC
  `).all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isStaff(user)) return forbidden();
  const body = await readJson(request);
  const name = stringValue(body, "name");
  if (!name) return badRequest("Название услуги обязательно");
  const id = newId();
  await env.DB.prepare(`
    INSERT INTO services (id, name, category, price, duration_minutes)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, name, stringValue(body, "category", "Подология"), numberValue(body, "price"), Math.max(15, numberValue(body, "durationMinutes", 60))).run();
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action, after_json) VALUES (?, ?, 'service', ?, 'CREATE', ?)")
    .bind(newId(), user.id, id, JSON.stringify({ name })).run();
  return json({ ok: true, id }, 201);
};
