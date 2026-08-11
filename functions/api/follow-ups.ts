import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, dateValue, json, newId, optionalString, readJson, stringValue } from "../_lib/http";
import { nonNegativeNumber } from "../_lib/validation";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "retention.read")) return forbidden();
  const params = new URL(request.url).searchParams;
  const status = params.get("status")?.trim().toUpperCase() || "OPEN";
  const filters = ["f.status = ?"]; const bindings: string[] = [status];
  if (user.role === "SPECIALIST") { filters.push("a.employee_id = (SELECT id FROM employees WHERE user_id = ? LIMIT 1)"); bindings.push(user.id); }
  const rows = await env.DB.prepare(`SELECT f.id, f.client_id AS clientId, c.full_name AS clientName, c.phone, f.appointment_id AS appointmentId, f.recommended_date AS recommendedDate, f.interval_days AS intervalDays, f.status, f.assigned_to AS assignedTo, f.created_at AS createdAt, a.starts_at AS appointmentStartsAt FROM follow_ups f INNER JOIN clients c ON c.id = f.client_id LEFT JOIN appointments a ON a.id = f.appointment_id WHERE ${filters.join(" AND ")} ORDER BY f.recommended_date ASC LIMIT 500`).bind(...bindings).all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "retention.write")) return forbidden();
  const body = await readJson(request);
  const clientId = stringValue(body, "clientId");
  const appointmentId = optionalString(body, "appointmentId");
  const days = body.intervalDays === undefined ? null : nonNegativeNumber(body.intervalDays, "Интервал");
  const recommendedDate = dateValue(body, "recommendedDate") || (days !== null && days >= 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : "");
  if (!clientId || !recommendedDate) return badRequest("Укажите клиента и дату повторного визита");
  if (!await env.DB.prepare("SELECT id FROM clients WHERE id = ? AND is_active = 1").bind(clientId).first()) return badRequest("Клиент не найден");
  const id = newId();
  const statements: D1PreparedStatement[] = [env.DB.prepare("INSERT INTO follow_ups (id, client_id, appointment_id, recommended_date, interval_days, assigned_to, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, clientId, appointmentId, recommendedDate, days, optionalString(body, "assignedTo") || user.id, user.id)];
  if (body.sendTelegram === true) {
    const recipient = await env.DB.prepare("SELECT u.telegram_id AS telegramId, c.full_name AS clientName FROM users u INNER JOIN clients c ON c.id = u.client_id WHERE c.id = ? AND u.notifications_allowed = 1 LIMIT 1").bind(clientId).first<{ telegramId: string; clientName: string }>();
    if (recipient) statements.push(env.DB.prepare("INSERT OR IGNORE INTO message_outbox (id, event_key, telegram_id, template_key, payload_json) VALUES (?, ?, ?, 'FOLLOW_UP', ?)").bind(newId(), `follow-up:${id}`, recipient.telegramId, JSON.stringify({ clientName: recipient.clientName })));
  }
  await env.DB.batch(statements);
  return json({ ok: true, id }, 201);
};
