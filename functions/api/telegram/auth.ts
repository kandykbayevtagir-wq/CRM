import { createSession, sessionCookie } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { json, readJson } from "../../_lib/http";
import { validateTelegramInitData } from "../../_lib/telegram";

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return json({ ok: false, error: "CRM access is not configured" }, 503);
  }

  const body = await readJson(request);
  const initData = typeof body.initData === "string" ? body.initData : "";
  const verified = await validateTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  const telegramUser = verified?.user;
  const telegramId = telegramUser?.id === undefined ? "" : String(telegramUser.id);
  const allowedIds = (env.CRM_ALLOWED_TELEGRAM_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const isAllowedStaff = allowedIds.includes(telegramId);

  if (!verified || !telegramUser || !telegramId) {
    return json({ ok: false, error: "Telegram data is invalid" }, 403);
  }

  const firstName = typeof telegramUser.first_name === "string" ? telegramUser.first_name : "";
  const lastName = typeof telegramUser.last_name === "string" ? telegramUser.last_name : "";
  const name = `${firstName} ${lastName}`.trim() || "Пользователь podologymk";
  const username = typeof telegramUser.username === "string" ? telegramUser.username : null;
  const avatarUrl = typeof telegramUser.photo_url === "string" ? telegramUser.photo_url : null;
  const existing = await env.DB.prepare("SELECT id, role, client_id AS clientId, phone, notifications_allowed AS notificationsAllowed, active, telegram_username AS telegramUsername FROM users WHERE telegram_id = ? LIMIT 1")
    .bind(telegramId)
    .first<{ id: string; role: string; clientId: string | null; phone: string | null; notificationsAllowed: number; active: number; telegramUsername: string | null }>();
  if (existing && existing.role !== "CLIENT" && !isAllowedStaff) {
    return json({ ok: false, error: "This staff account is not allowed" }, 403);
  }
  if (existing && existing.active !== 1) {
    return json({ ok: false, error: "Учётная запись деактивирована" }, 403);
  }
  if (!existing && !isAllowedStaff) {
    return json({ ok: false, error: "Пользователь не приглашён в CRM" }, 403);
  }
  const userId = existing?.id ?? crypto.randomUUID();
  const role = existing?.role ?? "OWNER";

  if (existing) {
    await env.DB.prepare(`
      UPDATE users
      SET name = ?, username = ?, telegram_username = ?, avatar_url = ?, last_seen_at = CURRENT_TIMESTAMP,
        last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(name, username, username, avatarUrl, userId).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO users (id, telegram_id, name, username, telegram_username, avatar_url, role, active, last_login_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    `).bind(userId, telegramId, name, username, username, avatarUrl, role).run();
  }

  const rawSession = await createSession(env.DB, userId);
  return json(
    { ok: true, user: { id: userId, telegramId, name, username, telegramUsername: username, avatarUrl, role, active: 1, lastLoginAt: new Date().toISOString(), clientId: existing?.clientId ?? null, phone: existing?.phone ?? null, notificationsAllowed: existing?.notificationsAllowed ?? 0 } },
    200,
    { "set-cookie": sessionCookie(rawSession) },
  );
};
