import { TelegramApiError, telegramApi } from "./telegram-bot";
import type { CrmEnv } from "./env";
import { hasPermission, type Permission } from "../../src/lib/permissions";

type OutboxRow = { id: string; telegramId: string; templateKey: string; payloadJson: string; attempts: number; leaseToken: string };
type Payload = Record<string, unknown>;

export function deliveryRetry(error: unknown, attempts: number) {
  if (error instanceof TelegramApiError && error.permanent) return { terminal: true, delaySeconds: 0, code: `TELEGRAM_${error.status}` };
  return {
    terminal: attempts >= 5,
    delaySeconds: Math.max(30, error instanceof TelegramApiError ? error.retryAfter ?? 0 : 0, Math.min(3600, 60 * 2 ** (attempts - 1))),
    code: error instanceof TelegramApiError ? `TELEGRAM_${error.status}` : "DELIVERY_UNAVAILABLE",
  };
}

export function renderNotification(template: string, payload: Payload) {
  return template.replace(/\{(clientName|date|time|specialist|service|branch|message)\}/g, (_, key: string) => String(payload[key] ?? ""));
}

export async function enqueueDueReminders(env: CrmEnv) {
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO message_outbox(id, event_key, telegram_id, template_key, payload_json)
      SELECT 'reminder-' || n.id, 'reminder:' || n.id, u.telegram_id, n.kind,
        json_object('notificationId', n.id, 'appointmentId', a.id, 'startsAt', a.starts_at,
          'clientName', c.full_name, 'specialist', e.full_name, 'branch', b.name,
          'timezone', os.timezone,
          'service', (SELECT group_concat(s.name, ', ') FROM appointment_services aps JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id))
      FROM notifications n
      JOIN appointments a ON a.id = n.appointment_id JOIN clients c ON c.id = a.client_id
      JOIN users u ON u.client_id = c.id AND u.active = 1 AND u.notifications_allowed = 1
      LEFT JOIN employees e ON e.id = a.employee_id LEFT JOIN branches b ON b.id = a.branch_id
      CROSS JOIN organization_settings os
      WHERE os.id = 1 AND c.is_active = 1 AND n.status = 'PENDING' AND n.kind IN ('REMINDER_24H', 'REMINDER_2H')
        AND NOT EXISTS(SELECT 1 FROM message_outbox mo WHERE mo.event_key = 'reminder:' || n.id)
        AND julianday(n.scheduled_at) <= julianday('now')
        AND julianday(a.starts_at) > julianday('now') AND a.status IN ('SCHEDULED', 'CONFIRMED')
      ORDER BY julianday(n.scheduled_at), n.id LIMIT 100`),
    env.DB.prepare(`UPDATE notifications SET status = 'CANCELLED'
      WHERE status = 'PENDING' AND kind IN ('REMINDER_24H', 'REMINDER_2H')
      AND (NOT EXISTS (SELECT 1 FROM appointments a WHERE a.id = notifications.appointment_id AND a.status IN ('SCHEDULED', 'CONFIRMED') AND julianday(a.starts_at) > julianday('now'))
        OR NOT EXISTS (SELECT 1 FROM users u JOIN clients c ON c.id = u.client_id WHERE u.client_id = notifications.client_id AND u.active = 1 AND u.notifications_allowed = 1 AND c.is_active = 1))`),
  ]);
}

function campaignStatements(env: CrmEnv, payload: Payload, status: "SENT" | "FAILED" | "SKIPPED", errorCode: string | null) {
  if (typeof payload.campaignId !== "string" || typeof payload.clientId !== "string") return [];
  return [
    env.DB.prepare("UPDATE campaign_recipients SET status = ?, attempts = attempts + 1, last_error = ?, sent_at = CASE WHEN ? = 'SENT' THEN CURRENT_TIMESTAMP ELSE sent_at END WHERE campaign_id = ? AND client_id = ?")
      .bind(status, errorCode, status, payload.campaignId, payload.clientId),
    env.DB.prepare(`UPDATE campaigns SET
      sent_count = (SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id = ? AND status = 'SENT'),
      error_count = (SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id = ? AND status = 'FAILED'),
      status = CASE WHEN NOT EXISTS(SELECT 1 FROM campaign_recipients WHERE campaign_id = ? AND status = 'PENDING') THEN 'COMPLETED' ELSE status END,
      updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status <> 'CANCELLED'`)
      .bind(payload.campaignId, payload.campaignId, payload.campaignId, payload.campaignId),
  ];
}

async function settle(env: CrmEnv, row: OutboxRow, payload: Payload, status: "SENT" | "FAILED" | "CANCELLED", errorCode: string | null, messageId: number | null = null) {
  const guardId = crypto.randomUUID();
  const statements = [
    env.DB.prepare("INSERT INTO mutation_guards(id, passed) SELECT ?, EXISTS(SELECT 1 FROM message_outbox WHERE id = ? AND status = 'PROCESSING' AND lease_token = ?)").bind(guardId, row.id, row.leaseToken),
    env.DB.prepare("DELETE FROM mutation_guards WHERE id = ?").bind(guardId),
    ...campaignStatements(env, payload, status === "CANCELLED" ? "SKIPPED" : status, errorCode),
  ];
  if (typeof payload.notificationId === "string") statements.push(env.DB.prepare("UPDATE notifications SET status = ?, sent_at = CASE WHEN ? = 'SENT' THEN CURRENT_TIMESTAMP ELSE sent_at END, attempts = ? WHERE id = ? AND status = 'PENDING'").bind(status, status, row.attempts, payload.notificationId));
  statements.push(env.DB.prepare(`UPDATE message_outbox SET status = ?, last_error = ?, telegram_message_id = ?,
    sent_at = CASE WHEN ? = 'SENT' THEN CURRENT_TIMESTAMP ELSE sent_at END,
    lease_token = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND lease_token = ?`).bind(status, errorCode, messageId, status, row.id, row.leaseToken));
  await env.DB.batch(statements);
}

export async function processOutbox(env: CrmEnv, onlyEventKey?: string) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_TOKEN_MISSING");
  // A worker crash at the final attempt must settle linked reminders/campaigns too.
  const expired = await env.DB.prepare(`SELECT id FROM message_outbox WHERE status = 'PROCESSING' AND attempts >= 5
    AND (julianday(lease_expires_at) <= julianday('now') OR (lease_expires_at IS NULL AND julianday(updated_at) < julianday('now', '-10 minutes'))) LIMIT 20`).all<{ id: string }>();
  for (const candidate of expired.results ?? []) {
    const row = await env.DB.prepare(`UPDATE message_outbox SET lease_token = ?, lease_expires_at = datetime('now', '+2 minutes')
      WHERE id = ? AND status = 'PROCESSING' AND attempts >= 5
        AND (julianday(lease_expires_at) <= julianday('now') OR (lease_expires_at IS NULL AND julianday(updated_at) < julianday('now', '-10 minutes')))
      RETURNING id, telegram_id AS telegramId, template_key AS templateKey, payload_json AS payloadJson, attempts, lease_token AS leaseToken`)
      .bind(crypto.randomUUID(), candidate.id).first<OutboxRow>();
    if (!row) continue;
    let payload: Payload = {};
    try { const value: unknown = JSON.parse(row.payloadJson); if (value && typeof value === "object" && !Array.isArray(value)) payload = value as Payload; } catch { /* Invalid payload is still terminal. */ }
    await settle(env, row, payload, "FAILED", "DELIVERY_LEASE_EXPIRED");
  }
  await env.DB.prepare(`UPDATE message_outbox SET status = 'PENDING',
    lease_token = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE status = 'PROCESSING' AND attempts < 5 AND (julianday(lease_expires_at) <= julianday('now')
      OR (lease_expires_at IS NULL AND julianday(updated_at) < julianday('now', '-10 minutes')))`).run();
  const candidates = await env.DB.prepare(`SELECT id FROM message_outbox
    WHERE status = 'PENDING' AND attempts < 5 AND julianday(next_retry_at) <= julianday('now')
    ${onlyEventKey ? "AND event_key = ?" : ""}
    ORDER BY CASE WHEN template_key = 'DIRECT' THEN 0 ELSE 1 END, next_retry_at LIMIT 6`)
    .bind(...(onlyEventKey ? [onlyEventKey] : [])).all<{ id: string }>();
  for (const candidate of candidates.results ?? []) {
    const leaseToken = crypto.randomUUID();
    const row = await env.DB.prepare(`UPDATE message_outbox SET status = 'PROCESSING', attempts = attempts + 1,
      lease_token = ?, lease_expires_at = datetime('now', '+2 minutes'), updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'PENDING' AND attempts < 5 AND julianday(next_retry_at) <= julianday('now')
      RETURNING id, telegram_id AS telegramId, template_key AS templateKey, payload_json AS payloadJson, attempts, lease_token AS leaseToken`)
      .bind(leaseToken, candidate.id).first<OutboxRow>();
    if (!row) continue;
    let payload: Payload = {};
    let sent = false;
    try {
      payload = JSON.parse(row.payloadJson) as Payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new TelegramApiError(400, null, "Invalid payload");
      if (row.templateKey === "DIRECT" && typeof payload.userId === "string") {
        const user = await env.DB.prepare("SELECT role, client_id AS clientId FROM users WHERE id = ? AND telegram_id = ? AND active = 1 AND (role <> 'CLIENT' OR EXISTS(SELECT 1 FROM clients c WHERE c.id = users.client_id AND c.is_active = 1))").bind(payload.userId, row.telegramId).first<{ role: string; clientId: string | null }>();
        if (!user || (payload.clientId && payload.clientId !== user.clientId) || (typeof payload.requiredPermission === "string" && !hasPermission(user.role, payload.requiredPermission as Permission))) {
          await settle(env, row, payload, "CANCELLED", "ACCESS_REVOKED"); continue;
        }
      }
      if (row.templateKey !== "DIRECT") {
        const recipient = await env.DB.prepare("SELECT u.id, u.client_id AS clientId FROM users u JOIN clients c ON c.id = u.client_id WHERE u.telegram_id = ? AND u.active = 1 AND u.notifications_allowed = 1 AND c.is_active = 1").bind(row.telegramId).first<{ id: string; clientId: string }>();
        let eligible = Boolean(recipient);
        if (typeof payload.notificationId === "string") {
          const reminder = ["REMINDER_24H", "REMINDER_2H"].includes(row.templateKey);
          eligible = eligible && Boolean(await env.DB.prepare(`SELECT n.id FROM notifications n JOIN appointments a ON a.id = n.appointment_id WHERE n.id = ? AND n.client_id = ? AND n.status = 'PENDING'
            ${reminder ? "AND a.status IN ('SCHEDULED','CONFIRMED') AND julianday(a.starts_at) > julianday('now') AND julianday(a.starts_at) = julianday(?)" : ""}`)
            .bind(payload.notificationId, recipient?.clientId ?? "", ...(reminder ? [payload.startsAt] : [])).first());
        }
        if (typeof payload.campaignId === "string") eligible = eligible && Boolean(await env.DB.prepare("SELECT cc.id FROM client_consents cc JOIN users u ON u.client_id = cc.client_id JOIN campaigns ca ON ca.id = ? WHERE u.telegram_id = ? AND cc.kind = 'MARKETING' AND cc.revoked_at IS NULL AND ca.status <> 'CANCELLED'").bind(payload.campaignId, row.telegramId).first());
        if (!eligible) { await settle(env, row, payload, "CANCELLED", "RECIPIENT_UNAVAILABLE"); continue; }
      }
      let text = String(payload.message ?? "");
      if (!["DIRECT", "CAMPAIGN"].includes(row.templateKey)) {
        const template = await env.DB.prepare("SELECT body, enabled FROM notification_templates WHERE template_key = ?").bind(row.templateKey).first<{ body: string; enabled: number }>();
        if (!template?.enabled) { await settle(env, row, payload, "CANCELLED", "TEMPLATE_DISABLED"); continue; }
        if (typeof payload.startsAt === "string") {
          const timezone = String(payload.timezone || "Asia/Almaty");
          payload.date = new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, dateStyle: "long" }).format(new Date(payload.startsAt));
          payload.time = new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, timeStyle: "short" }).format(new Date(payload.startsAt));
        }
        text = renderNotification(template.body, payload);
      }
      if (!text || text.length > 4096) throw new TelegramApiError(400, null, "Invalid message length");
      const replyMarkup = payload.replyMarkup ?? (["REMINDER_24H", "REMINDER_2H"].includes(row.templateKey) && typeof payload.appointmentId === "string" ? {
        inline_keyboard: [[{ text: "Подтвердить визит", callback_data: `confirm:${payload.appointmentId}` }],
          [{ text: "Мои записи", web_app: { url: `${env.MINI_APP_URL || "https://podologymk-crm.pages.dev"}/client/appointments` } }]],
      } : undefined);
      const response = await telegramApi(env, "sendMessage", { chat_id: row.telegramId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
      sent = true;
      await settle(env, row, payload, "SENT", null, response.result?.message_id ?? null);
    } catch (error) {
      if (sent) { console.error(JSON.stringify({ event: "delivery_commit_failed", messageId: row.id })); continue; }
      const retry = deliveryRetry(error, row.attempts);
      if (retry.terminal) await settle(env, row, payload, "FAILED", retry.code);
      else await env.DB.prepare("UPDATE message_outbox SET status = 'PENDING', last_error = ?, next_retry_at = datetime('now', ?), lease_token = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND lease_token = ?")
        .bind(retry.code, `+${retry.delaySeconds} seconds`, row.id, row.leaseToken).run();
      if (error instanceof TelegramApiError && error.status === 429) break;
    }
  }
}
