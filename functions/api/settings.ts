import { getSessionUser, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, json, now, readJson, stringValue } from "../_lib/http";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  const settings = await env.DB.prepare("SELECT brand_name AS brandName, currency, timezone FROM organization_settings WHERE id = 1").first();
  const branches = await env.DB.prepare("SELECT id, name, address, phone, is_active AS isActive FROM branches ORDER BY name ASC").all();
  return json({ ok: true, settings, branches: branches.results ?? [] });
};

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  const body = await readJson(request);
  const brandName = stringValue(body, "brandName");
  const currency = stringValue(body, "currency", "KZT");
  const timezone = stringValue(body, "timezone", "Asia/Almaty");
  if (!brandName) return badRequest("Название организации обязательно");
  await env.DB.prepare(`
    UPDATE organization_settings SET brand_name = ?, currency = ?, timezone = ?, updated_at = ? WHERE id = 1
  `).bind(brandName, currency, timezone, now()).run();
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action, after_json) VALUES (?, ?, 'settings', '1', 'UPDATE', ?)")
    .bind(crypto.randomUUID(), user.id, JSON.stringify({ brandName, currency, timezone })).run();
  return json({ ok: true });
};
