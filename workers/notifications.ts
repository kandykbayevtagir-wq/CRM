interface NotificationEnv {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
}

type NotificationRow = {
  id: string;
  kind: string;
  telegramId: string;
  clientName: string;
  startsAt: string;
  serviceName: string | null;
  branchName: string | null;
};

type TelegramResult = { ok: boolean; description?: string };

type OutboxRow = { id: string; eventKey: string; telegramId: string; templateKey: string; payloadJson: string; attempts: number };

async function sendRawTelegramMessage(token: string, telegramId: string, text: string) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: telegramId, text }),
  });
  const result = await response.json() as TelegramResult;
  if (!response.ok || !result.ok) throw new Error(result.description ?? "Telegram notification failed");
}

async function sendTelegramMessage(token: string, row: NotificationRow) {
  const date = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Almaty" }).format(new Date(row.startsAt));
  const prefix = row.kind === "REMINDER_24H" ? "⏰ Напоминание о визите завтра" : "⏰ Напоминание о визите через 2 часа";
  const text = `${prefix}\n\n${row.serviceName ?? "Приём в podologymk"}\n${date}\n${row.branchName ?? "Филиал уточняется"}\n\nЕсли планы изменились, откройте Mini App и перенесите запись.`;
  await sendRawTelegramMessage(token, row.telegramId, text);
}

async function processNotifications(env: NotificationEnv) {
  const rows = await env.DB.prepare(`
    SELECT n.id, n.kind, u.telegram_id AS telegramId, c.full_name AS clientName, a.starts_at AS startsAt,
      (SELECT s.name FROM appointment_services aps INNER JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id LIMIT 1) AS serviceName,
      b.name AS branchName
    FROM notifications n
    INNER JOIN users u ON u.id = n.user_id
    INNER JOIN clients c ON c.id = n.client_id
    INNER JOIN appointments a ON a.id = n.appointment_id
    LEFT JOIN branches b ON b.id = a.branch_id
    WHERE n.status = 'PENDING' AND n.kind IN ('REMINDER_24H', 'REMINDER_2H') AND u.notifications_allowed = 1
      AND a.status NOT IN ('CANCELLED', 'NO_SHOW')
      AND julianday(n.scheduled_at) <= julianday('now')
    ORDER BY n.scheduled_at ASC
    LIMIT 100
  `).all<NotificationRow>();

  for (const row of rows.results ?? []) {
    try {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, row);
      await env.DB.prepare("UPDATE notifications SET status = 'SENT', sent_at = CURRENT_TIMESTAMP, attempts = attempts + 1 WHERE id = ? AND status = 'PENDING'").bind(row.id).run();
    } catch (error) {
      console.error("Notification delivery failed", row.id, error);
      await env.DB.prepare("UPDATE notifications SET status = CASE WHEN attempts >= 2 THEN 'FAILED' ELSE 'PENDING' END, attempts = attempts + 1 WHERE id = ? AND status = 'PENDING'").bind(row.id).run();
    }
  }
}

function renderTemplate(template: string, payload: Record<string, unknown>) {
  return template.replace(/\{(clientName|date|time|specialist|service|branch|message)\}/g, (_, key: string) => String(payload[key] ?? ""));
}

async function processOutbox(env: NotificationEnv) {
  // Recover messages left PROCESSING by a worker restart before claiming new work.
  await env.DB.prepare("UPDATE message_outbox SET status = 'PENDING', next_retry_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE status = 'PROCESSING' AND updated_at < datetime('now', '-10 minutes')").run();
  const rows = await env.DB.prepare(`SELECT mo.id, mo.event_key AS eventKey, mo.telegram_id AS telegramId, mo.template_key AS templateKey, mo.payload_json AS payloadJson, mo.attempts FROM message_outbox mo WHERE mo.status IN ('PENDING', 'FAILED') AND mo.attempts < 3 AND mo.next_retry_at <= CURRENT_TIMESTAMP ORDER BY mo.next_retry_at ASC LIMIT 100`).all<OutboxRow>();
  for (const row of rows.results ?? []) {
    const claim = await env.DB.prepare("UPDATE message_outbox SET status = 'PROCESSING', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('PENDING', 'FAILED') AND attempts < 3").bind(row.id).run();
    if (!claim.meta.changes) continue;
    try {
      const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
      const template = row.templateKey === "CAMPAIGN"
        ? String(payload.message ?? "")
        : (await env.DB.prepare("SELECT body, enabled FROM notification_templates WHERE template_key = ? LIMIT 1").bind(row.templateKey).first<{ body: string; enabled: number }>()) ?? { body: "", enabled: 0 };
      const body = typeof template === "string" ? template : template.enabled ? template.body : "";
      if (!body) throw new Error("Notification template is disabled or missing");
      await sendRawTelegramMessage(env.TELEGRAM_BOT_TOKEN, row.telegramId, renderTemplate(body, payload));
      await env.DB.prepare("UPDATE message_outbox SET status = 'SENT', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'PROCESSING'").bind(row.id).run();
      if (typeof payload.campaignId === "string" && typeof payload.clientId === "string") {
        await env.DB.batch([
          env.DB.prepare("UPDATE campaign_recipients SET status = 'SENT', sent_at = CURRENT_TIMESTAMP, attempts = attempts + 1 WHERE campaign_id = ? AND client_id = ? AND status <> 'SENT'").bind(payload.campaignId, payload.clientId),
          env.DB.prepare("UPDATE campaigns SET sent_count = sent_count + 1, status = CASE WHEN sent_count + error_count + 1 >= recipient_count THEN 'COMPLETED' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(payload.campaignId),
        ]);
      }
    } catch (error) {
      const attempts = row.attempts + 1;
      const message = error instanceof Error ? error.message : "Telegram delivery failed";
      const status = attempts >= 3 ? "FAILED" : "PENDING";
      await env.DB.prepare("UPDATE message_outbox SET status = ?, last_error = ?, next_retry_at = datetime('now', ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(status, message, `+${Math.min(60, 5 * 2 ** Math.max(0, attempts - 1))} minutes`, row.id).run();
      const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
      if (status === "FAILED" && typeof payload.campaignId === "string" && typeof payload.clientId === "string") {
        await env.DB.batch([
          env.DB.prepare("UPDATE campaign_recipients SET status = 'FAILED', last_error = ?, attempts = attempts + 1 WHERE campaign_id = ? AND client_id = ?").bind(message, payload.campaignId, payload.clientId),
          env.DB.prepare("UPDATE campaigns SET error_count = error_count + 1, status = CASE WHEN sent_count + error_count + 1 >= recipient_count THEN 'COMPLETED' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(payload.campaignId),
        ]);
      }
    }
  }
}

export default {
  async scheduled(_controller: ScheduledController, env: NotificationEnv, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.all([processNotifications(env), processOutbox(env)]));
  },
};
