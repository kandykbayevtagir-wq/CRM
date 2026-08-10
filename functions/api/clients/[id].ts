import { getSessionUser, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, json, newId, notFound, optionalString, readJson, stringValue } from "../../_lib/http";

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  const id = params.id;
  const existing = await env.DB.prepare("SELECT full_name AS fullName, phone, email, notes FROM clients WHERE id = ?").bind(id).first();
  if (!existing) return notFound("Клиент не найден");
  const body = await readJson(request);
  const fullName = stringValue(body, "fullName", String(existing.fullName ?? ""));
  const phone = stringValue(body, "phone", String(existing.phone ?? ""));
  if (!fullName || !phone) return badRequest("Имя и телефон клиента обязательны");
  await env.DB.prepare(`UPDATE clients SET full_name = ?, phone = ?, email = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(fullName, phone, optionalString(body, "email") ?? existing.email ?? null, optionalString(body, "notes") ?? existing.notes ?? null, id).run();
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action, after_json) VALUES (?, ?, 'client', ?, 'UPDATE', ?)")
    .bind(newId(), user.id, id, JSON.stringify({ fullName, phone })).run();
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  const result = await env.DB.prepare("DELETE FROM clients WHERE id = ?").bind(params.id).run();
  if (!result.success || result.meta.changes === 0) return notFound("Клиент не найден");
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action) VALUES (?, ?, 'client', ?, 'DELETE')")
    .bind(newId(), user.id, params.id).run();
  return json({ ok: true });
};
