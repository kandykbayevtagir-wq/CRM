import { auditStatement } from "../../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../../_lib/auth";
import type { CrmEnv } from "../../../_lib/env";
import { badRequest, json, notFound, optionalString, readJson, stringValue } from "../../../_lib/http";

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "inventory.write")) return forbidden();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const existing = await env.DB.prepare("SELECT * FROM suppliers WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!existing) return notFound("Поставщик не найден");
  const body = await readJson(request);
  const name = stringValue(body, "name", String(existing.name ?? ""));
  if (!name) return badRequest("Название поставщика обязательно");
  await env.DB.batch([
    env.DB.prepare("UPDATE suppliers SET name = ?, contact_name = ?, phone = ?, telegram = ?, whatsapp = ?, email = ?, notes = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(name, optionalString(body, "contactName") ?? existing.contact_name ?? null, optionalString(body, "phone") ?? existing.phone ?? null, optionalString(body, "telegram") ?? existing.telegram ?? null, optionalString(body, "whatsapp") ?? existing.whatsapp ?? null, optionalString(body, "email") ?? existing.email ?? null, optionalString(body, "notes") ?? existing.notes ?? null, body.isActive === false ? 0 : 1, id),
    auditStatement(env.DB, user, "supplier", id, "UPDATE", { name: existing.name }, { name }),
  ]);
  return json({ ok: true });
};
