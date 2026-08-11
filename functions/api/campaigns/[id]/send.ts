import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../../_lib/auth";
import type { CrmEnv } from "../../../_lib/env";
import { badRequest, json, newId } from "../../../_lib/http";

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "campaigns.write")) return forbidden();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const campaign = await env.DB.prepare("SELECT id, segment_id AS segmentId, message, status FROM campaigns WHERE id = ?").bind(id).first<{ id: string; segmentId: string | null; message: string; status: string }>();
  if (!campaign) return badRequest("Кампания не найдена");
  if (!["DRAFT", "SCHEDULED"].includes(campaign.status)) return badRequest("Кампания уже запускалась или отменена");
  const recipients = await env.DB.prepare(`SELECT c.id AS clientId, u.telegram_id AS telegramId, c.full_name AS clientName FROM clients c INNER JOIN users u ON u.client_id = c.id AND u.active = 1 AND u.notifications_allowed = 1 WHERE c.is_active = 1${campaign.segmentId ? " AND (SELECT 1 FROM client_segments cs WHERE cs.id = ? AND (json_extract(cs.criteria_json, '$.minVisits') IS NULL OR (SELECT COUNT(*) FROM appointments av WHERE av.client_id = c.id AND av.status = 'COMPLETED') >= json_extract(cs.criteria_json, '$.minVisits')) AND (json_extract(cs.criteria_json, '$.minRevenue') IS NULL OR (SELECT COALESCE(SUM(p.amount), 0) FROM payments p INNER JOIN appointments ap ON ap.id = p.appointment_id WHERE ap.client_id = c.id AND p.payment_status = 'POSTED') >= json_extract(cs.criteria_json, '$.minRevenue')))" : ""}`).bind(...(campaign.segmentId ? [campaign.segmentId] : [])).all<{ clientId: string; telegramId: string; clientName: string }>();
  if (!recipients.results?.length) return badRequest("В выбранном сегменте нет клиентов с разрешёнными Telegram-уведомлениями");
  const statements: D1PreparedStatement[] = [env.DB.prepare("UPDATE campaigns SET status = 'PROCESSING', recipient_count = ?, sent_count = 0, error_count = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(recipients.results.length, id)];
  for (const recipient of recipients.results) {
    const eventKey = `campaign:${id}:${recipient.clientId}`;
    statements.push(
      env.DB.prepare("INSERT OR IGNORE INTO campaign_recipients (id, campaign_id, client_id, telegram_id) VALUES (?, ?, ?, ?)").bind(newId(), id, recipient.clientId, recipient.telegramId),
      env.DB.prepare("INSERT OR IGNORE INTO message_outbox (id, event_key, telegram_id, template_key, payload_json) VALUES (?, ?, ?, 'CAMPAIGN', ?)").bind(newId(), eventKey, recipient.telegramId, JSON.stringify({ message: campaign.message, clientName: recipient.clientName, campaignId: id, clientId: recipient.clientId })),
    );
  }
  await env.DB.batch(statements);
  return json({ ok: true, recipientCount: recipients.results.length });
};
