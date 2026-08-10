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

async function sendTelegramMessage(token: string, row: NotificationRow) {
  const date = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Almaty" }).format(new Date(row.startsAt));
  const prefix = row.kind === "REMINDER_24H" ? "⏰ Напоминание о визите завтра" : "⏰ Напоминание о визите через 2 часа";
  const text = `${prefix}\n\n${row.serviceName ?? "Приём в podologymk"}\n${date}\n${row.branchName ?? "Филиал уточняется"}\n\nЕсли планы изменились, откройте Mini App и перенесите запись.`;
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: row.telegramId, text }),
  });
  const result = await response.json() as TelegramResult;
  if (!response.ok || !result.ok) throw new Error(result.description ?? "Telegram notification failed");
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
    WHERE n.status = 'PENDING' AND u.notifications_allowed = 1
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

export default {
  async scheduled(_controller: ScheduledController, env: NotificationEnv, ctx: ExecutionContext) {
    ctx.waitUntil(processNotifications(env));
  },
};
