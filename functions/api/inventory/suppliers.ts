import { auditStatement } from "../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, json, newId, optionalString, readJson, stringValue } from "../../_lib/http";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "inventory.read")) return forbidden();
  const rows = await env.DB.prepare("SELECT id, name, contact_name AS contactName, phone, telegram, whatsapp, email, notes, is_active AS isActive FROM suppliers ORDER BY is_active DESC, name").all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "inventory.write")) return forbidden();
  const body = await readJson(request);
  const name = stringValue(body, "name");
  if (!name) return badRequest("Название поставщика обязательно");
  const id = newId();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO suppliers (id, name, contact_name, phone, telegram, whatsapp, email, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, name, optionalString(body, "contactName"), optionalString(body, "phone"), optionalString(body, "telegram"), optionalString(body, "whatsapp"), optionalString(body, "email"), optionalString(body, "notes"), user.id),
    auditStatement(env.DB, user, "supplier", id, "CREATE", null, { name }),
  ]);
  return json({ ok: true, id }, 201);
};
