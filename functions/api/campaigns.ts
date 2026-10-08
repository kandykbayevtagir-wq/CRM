import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, json, newId, optionalString, readJson, stringValue } from "../_lib/http";
import { organizationTimezone,zonedDateValue } from '../_lib/dates';

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "campaigns.read")) return forbidden();
  const rows = await env.DB.prepare("SELECT c.id, c.name, c.segment_id AS segmentId, s.name AS segmentName, c.message, c.scheduled_at AS scheduledAt, c.status, c.recipient_count AS recipientCount, c.sent_count AS sentCount, c.error_count AS errorCount, c.created_at AS createdAt, c.updated_at AS updatedAt FROM campaigns c LEFT JOIN client_segments s ON s.id = c.segment_id ORDER BY c.created_at DESC LIMIT 200").all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "campaigns.write")) return forbidden();
  const body = await readJson(request);
  const name = stringValue(body, "name");
  const message = stringValue(body, "message");
  if (!name || !message) return badRequest("Название и текст кампании обязательны");
  if (name.length > 200) return badRequest("Название кампании не длиннее 200 символов", { name: "Не длиннее 200 символов" });
  // Telegram rejects messages above 4096 characters; the template variables may expand the text, so keep a margin.
  if (message.length > 3800) return badRequest("Текст сообщения не длиннее 3800 символов", { message: "Сократите текст: лимит Telegram — 4096 символов вместе с подстановками" });
  const segmentId = optionalString(body, "segmentId") || null;
  if (segmentId && !await env.DB.prepare("SELECT id FROM client_segments WHERE id = ? AND is_active = 1").bind(segmentId).first()) return badRequest("Сегмент не найден");
  const id = newId();
  const scheduledAt=zonedDateValue(body,'scheduledAt',await organizationTimezone(env.DB));
  if(body.scheduledAt && !scheduledAt) return badRequest('Некорректная дата запуска');
  await env.DB.prepare("INSERT INTO campaigns (id, name, segment_id, message, scheduled_at, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, name, segmentId, message, scheduledAt || null, scheduledAt ? "SCHEDULED" : "DRAFT", user.id).run();
  return json({ ok: true, id }, 201);
};
