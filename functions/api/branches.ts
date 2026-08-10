import { forbidden, getSessionUser, isStaff, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, json, newId, readJson, stringValue } from "../_lib/http";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isStaff(user)) return forbidden();
  const rows = await env.DB.prepare("SELECT id, name, address, phone, is_active AS isActive FROM branches ORDER BY name ASC").all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isStaff(user)) return forbidden();
  const body = await readJson(request);
  const name = stringValue(body, "name");
  if (!name) return badRequest("Название филиала обязательно");
  const id = newId();
  await env.DB.prepare("INSERT INTO branches (id, name, address, phone) VALUES (?, ?, ?, ?)")
    .bind(id, name, stringValue(body, "address") || null, stringValue(body, "phone") || null)
    .run();
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action, after_json) VALUES (?, ?, 'branch', ?, 'CREATE', ?)")
    .bind(newId(), user.id, id, JSON.stringify({ name })).run();
  return json({ ok: true, id }, 201);
};
