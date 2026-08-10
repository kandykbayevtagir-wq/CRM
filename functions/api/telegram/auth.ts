import { createSession, sessionCookie } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { json, readJson } from "../../_lib/http";
import { validateTelegramInitData } from "../../_lib/telegram";

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  if (!env.TELEGRAM_BOT_TOKEN || !env.CRM_ALLOWED_TELEGRAM_IDS) {
    return json({ ok: false, error: "CRM access is not configured" }, 503);
  }

  const body = await readJson(request);
  const initData = typeof body.initData === "string" ? body.initData : "";
  const verified = await validateTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  const telegramUser = verified?.user;
  const telegramId = telegramUser?.id === undefined ? "" : String(telegramUser.id);
  const allowedIds = env.CRM_ALLOWED_TELEGRAM_IDS.split(",").map((value) => value.trim()).filter(Boolean);

  if (!verified || !telegramUser || !telegramId || !allowedIds.includes(telegramId)) {
    return json({ ok: false, error: "This Telegram account is not allowed" }, 403);
  }

  const firstName = typeof telegramUser.first_name === "string" ? telegramUser.first_name : "";
  const lastName = typeof telegramUser.last_name === "string" ? telegramUser.last_name : "";
  const name = `${firstName} ${lastName}`.trim() || "Пользователь podologymk";
  const username = typeof telegramUser.username === "string" ? telegramUser.username : null;
  const avatarUrl = typeof telegramUser.photo_url === "string" ? telegramUser.photo_url : null;
  const existing = await env.DB.prepare("SELECT id, role FROM users WHERE telegram_id = ? LIMIT 1")
    .bind(telegramId)
    .first<{ id: string; role: string }>();
  const userId = existing?.id ?? crypto.randomUUID();

  if (existing) {
    await env.DB.prepare(`
      UPDATE users
      SET name = ?, username = ?, avatar_url = ?, last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(name, username, avatarUrl, userId).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO users (id, telegram_id, name, username, avatar_url, role)
      VALUES (?, ?, ?, ?, ?, 'OWNER')
    `).bind(userId, telegramId, name, username, avatarUrl).run();
  }

  const rawSession = await createSession(env.DB, userId);
  return json(
    { ok: true, user: { id: userId, telegramId, name, username, avatarUrl, role: existing?.role ?? "OWNER" } },
    200,
    { "set-cookie": sessionCookie(rawSession) },
  );
};
