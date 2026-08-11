import { auditStatement } from "../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, conflict, json, newId, optionalString, readJson, stringValue } from "../_lib/http";

const roles = new Set(["OWNER", "ADMINISTRATOR", "SPECIALIST", "ACCOUNTANT", "CLIENT"]);

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "users.read")) return forbidden();
  const rows = await env.DB.prepare("SELECT id, telegram_id AS telegramId, username, name, role, active, client_id AS clientId, phone, last_login_at AS lastLoginAt, created_at AS createdAt FROM users ORDER BY active DESC, name ASC").all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "users.write")) return forbidden();
  const body = await readJson(request);
  const telegramId = stringValue(body, "telegramId");
  const name = stringValue(body, "name");
  const role = stringValue(body, "role", "ADMINISTRATOR").toUpperCase();
  const clientId = optionalString(body, "clientId");
  if (!telegramId || !name || !roles.has(role)) return badRequest("Telegram ID, имя и корректная роль обязательны");
  const duplicate = await env.DB.prepare("SELECT id FROM users WHERE telegram_id = ?").bind(telegramId).first();
  if (duplicate) return conflict("Пользователь с таким Telegram ID уже существует");
  if (role === "CLIENT" && !clientId) return badRequest("Для роли клиента укажите связанную карточку клиента");
  if (role === "CLIENT") {
    const client = await env.DB.prepare(`
      SELECT c.id FROM clients c
      WHERE c.id = ? AND c.is_active = 1
        AND NOT EXISTS (SELECT 1 FROM users linked_user WHERE linked_user.client_id = c.id)
    `).bind(clientId).first<{ id: string }>();
    if (!client) return conflict("Карточка клиента не найдена или уже привязана к другому Telegram ID");
  }
  const id = newId();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, telegram_id, name, username, telegram_username, avatar_url, role, client_id, phone, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)").bind(id, telegramId, name, optionalString(body, "username"), optionalString(body, "username"), optionalString(body, "avatarUrl"), role, clientId, optionalString(body, "phone")),
    auditStatement(env.DB, user, "user", id, "CREATE", null, { telegramId, name, role }),
  ]);
  return json({ ok: true, id }, 201);
};
