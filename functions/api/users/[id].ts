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
  const clientId = body.clientId === null ? null : stringValue(body, "clientId", existing.clientId ?? "") || null;
  const active = body.active === undefined ? existing.active : body.active === false || body.active === "false" ? 0 : 1;
  if (!new Set(["OWNER", "ADMINISTRATOR", "SPECIALIST", "ACCOUNTANT", "CLIENT"]).has(role)) return badRequest("Некорректная роль");
  if (role === "CLIENT" && !clientId) return badRequest("Для роли клиента укажите связанную карточку клиента");
  if (role === "CLIENT" && clientId) {
    const client = await env.DB.prepare(`
      SELECT c.id FROM clients c
      WHERE c.id = ? AND c.is_active = 1
        AND NOT EXISTS (SELECT 1 FROM users linked_user WHERE linked_user.client_id = c.id AND linked_user.id <> ?)
    `).bind(clientId, id).first<{ id: string }>();
    if (!client) return badRequest("Карточка клиента не найдена или уже привязана к другому Telegram ID");
  }
  if (id === user.id && (active === 0 || role !== "OWNER")) return badRequest("Нельзя отключить или понизить собственную учётную запись владельца");
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET name = ?, role = ?, active = ?, client_id = ?, phone = COALESCE(?, phone), updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(stringValue(body, "name", existing.name), role, active, clientId, body.phone === null ? null : stringValue(body, "phone") || null, id),
    auditStatement(env.DB, user, "user", id, "UPDATE", { role: existing.role, active: existing.active }, { role, active }),
  ]);
  return json({ ok: true });
};
