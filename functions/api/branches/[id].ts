import { auditStatement } from "../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, json, notFound, optionalString, readJson, stringValue } from "../../_lib/http";

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "settings.write")) return forbidden();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const existing = await env.DB.prepare("SELECT * FROM branches WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!existing) return notFound("Филиал не найден");
  const body = await readJson(request);
  const name = stringValue(body, "name", String(existing.name ?? ""));
  if (!name) return badRequest("Название филиала обязательно");
  const active = body.isActive === undefined ? Number(existing.is_active ?? 1) : body.isActive === false || body.isActive === "false" ? 0 : 1;
  await env.DB.batch([
    env.DB.prepare("UPDATE branches SET name = ?, address = ?, phone = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(name, body.address === null ? null : optionalString(body, "address") ?? existing.address ?? null, body.phone === null ? null : optionalString(body, "phone") ?? existing.phone ?? null, active, id),
    auditStatement(env.DB, user, "branch", id, "UPDATE", { name: existing.name, isActive: existing.is_active }, { name, isActive: active }),
  ]);
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "settings.write")) return forbidden();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const result = await env.DB.prepare("UPDATE branches SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
  if (!result.success || result.meta.changes === 0) return notFound("Филиал не найден");
  await env.DB.batch([auditStatement(env.DB, user, "branch", id, "ARCHIVE", { isActive: 1 }, { isActive: 0 })]);
  return json({ ok: true });
};
