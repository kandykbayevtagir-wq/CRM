import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, json, notFound, readJson, stringValue } from "../../_lib/http";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "campaigns.read")) return forbidden();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [campaign, recipients] = await Promise.all([
    env.DB.prepare("SELECT id, name, segment_id AS segmentId, message, scheduled_at AS scheduledAt, status, recipient_count AS recipientCount, sent_count AS sentCount, error_count AS errorCount FROM campaigns WHERE id = ?").bind(id).first(),
    env.DB.prepare("SELECT cr.id, cr.client_id AS clientId, c.full_name AS clientName, cr.status, cr.attempts, cr.last_error AS lastError, cr.sent_at AS sentAt FROM campaign_recipients cr INNER JOIN clients c ON c.id = cr.client_id WHERE cr.campaign_id = ? ORDER BY c.full_name LIMIT 1000").bind(id).all(),
  ]);
  if (!campaign) return notFound("Кампания не найдена");
  return json({ ok: true, campaign, recipients: recipients.results ?? [] });
};

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "campaigns.write")) return forbidden();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const existing = await env.DB.prepare("SELECT status FROM campaigns WHERE id = ?").bind(id).first<{ status: string }>();
  if (!existing) return notFound("Кампания не найдена");
  const body = await readJson(request);
  const status = stringValue(body, "status", existing.status).toUpperCase();
  if (!["DRAFT", "SCHEDULED", "CANCELLED"].includes(status) || ["PROCESSING", "COMPLETED"].includes(existing.status)) return badRequest("Кампания уже запущена или имеет некорректный статус");
  await env.DB.prepare("UPDATE campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(status, id).run();
  return json({ ok: true });
};
