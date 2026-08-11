import { auditStatement } from "../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, json, newId, readJson, stringValue } from "../../_lib/http";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "inventory.read")) return forbidden();
  const rows = await env.DB.prepare("SELECT id, name, active, created_at AS createdAt FROM product_categories WHERE active = 1 ORDER BY name").all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "inventory.write")) return forbidden();
  const name = stringValue(await readJson(request), "name");
  if (!name) return badRequest("Название категории обязательно");
  const id = newId();
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO product_categories (id, name) VALUES (?, ?)").bind(id, name),
      auditStatement(env.DB, user, "product_category", id, "CREATE", null, { name }),
    ]);
  } catch {
    return badRequest("Такая категория уже существует");
  }
  return json({ ok: true, id }, 201);
};
