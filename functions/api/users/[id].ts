import { auditStatement } from "../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, json, notFound, readJson, stringValue } from "../../_lib/http";

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "users.write")) return forbidden();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const existing = await env.DB.prepare("SELECT id, role, active, name, client_id AS clientId FROM users WHERE id = ?").bind(id).first<{ id: string; role: string; active: number; name: string; clientId: string | null }>();
  if (!existing) return notFound("Пользователь не найден");
  const body = await readJson(request);
  const role = stringValue(body, "role", existing.role).toUpperCase();
  const active = body.active === undefined ? existing.active : body.active === false || body.active === "false" ? 0 : 1;
  if (!new Set(["OWNER", "ADMINISTRATOR", "SPECIALIST", "ACCOUNTANT", "CLIENT"]).has(role)) return badRequest("Некорректная роль");
  if (role === "CLIENT" && !stringValue(body, "clientId", existing.clientId ?? "")) return badRequest("Для роли клиента укажите связанную карточку клиента");
  if (id === user.id && (active === 0 || role !== "OWNER")) return badRequest("Нельзя отключить или понизить собственную учётную запись владельца");
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET name = ?, role = ?, active = ?, client_id = COALESCE(?, client_id), phone = COALESCE(?, phone), updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(stringValue(body, "name", existing.name), role, active, body.clientId === null ? null : stringValue(body, "clientId") || null, body.phone === null ? null : stringValue(body, "phone") || null, id),
    auditStatement(env.DB, user, "user", id, "UPDATE", { role: existing.role, active: existing.active }, { role, active }),
  ]);
  return json({ ok: true });
};
