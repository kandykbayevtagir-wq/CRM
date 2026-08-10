import { forbidden, getSessionUser, isClient, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, json, newId, readJson, stringValue, numberValue } from "../../_lib/http";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isClient(user)) return forbidden();
  if (!user.clientId) return json({ ok: true, items: [] });
  const rows = await env.DB.prepare(`
    SELECT a.id AS appointmentId, a.starts_at AS startsAt, a.total_amount AS amount,
      s.name AS serviceName, r.id AS reviewId, r.rating, r.review_text AS reviewText, r.status
    FROM appointments a
    LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
    LEFT JOIN services s ON s.id = aps.service_id
    LEFT JOIN client_reviews r ON r.appointment_id = a.id
    WHERE a.client_id = ? AND a.status = 'COMPLETED'
    ORDER BY a.starts_at DESC LIMIT 50
  `).bind(user.clientId).all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isClient(user)) return forbidden();
  if (!user.clientId) return badRequest("Сначала заполните профиль");
  const body = await readJson(request);
  const appointmentId = stringValue(body, "appointmentId");
  const rating = numberValue(body, "rating");
  if (!appointmentId || rating < 1 || rating > 5) return badRequest("Выберите оценку от 1 до 5");
  const appointment = await env.DB.prepare("SELECT id FROM appointments WHERE id = ? AND client_id = ? AND status = 'COMPLETED'").bind(appointmentId, user.clientId).first();
  if (!appointment) return badRequest("Отзыв можно оставить только после завершённого приёма");
  const id = newId();
  try {
    await env.DB.prepare("INSERT INTO client_reviews (id, client_id, appointment_id, rating, review_text) VALUES (?, ?, ?, ?, ?)").bind(id, user.clientId, appointmentId, rating, stringValue(body, "reviewText") || null).run();
  } catch {
    return badRequest("Для этой записи отзыв уже оставлен");
  }
  return json({ ok: true, id }, 201);
};
