import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, dateValue, json, newId, optionalString, readJson, stringValue } from "../_lib/http";

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
  const id = newId();
  await env.DB.prepare("INSERT INTO campaigns (id, name, segment_id, message, scheduled_at, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, name, optionalString(body, "segmentId"), message, dateValue(body, "scheduledAt") || null, dateValue(body, "scheduledAt") ? "SCHEDULED" : "DRAFT", user.id).run();
  return json({ ok: true, id }, 201);
};
