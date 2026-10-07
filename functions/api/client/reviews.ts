import { getActiveClientId } from "../../_lib/access";
import { forbidden, getSessionUser, isClient, unauthorized } from "../../_lib/auth";
import { isoColumn } from "../../_lib/dates";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, json, newId, readJson, stringValue, numberValue } from "../../_lib/http";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isClient(user)) return forbidden();
  const clientId = await getActiveClientId(env.DB, user);
  if (!clientId) return json({ ok: true, items: [] });
  const rows = await env.DB.prepare(`
    SELECT a.id AS appointmentId, ${isoColumn("a.starts_at")} AS startsAt, a.total_amount AS amount,
      (SELECT group_concat(s.name, ', ') FROM appointment_services aps INNER JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id) AS serviceName,
      r.id AS reviewId, r.rating, r.review_text AS reviewText, r.status
    FROM appointments a
    LEFT JOIN client_reviews r ON r.appointment_id = a.id
    WHERE a.client_id = ? AND a.status = 'COMPLETED'
    ORDER BY julianday(a.starts_at) DESC LIMIT 50
  `).bind(clientId).all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isClient(user)) return forbidden();
  if (!user.clientId) return badRequest("Сначала заполните профиль");
  if (!await getActiveClientId(env.DB, user)) return forbidden("Карточка клиента архивирована. Обратитесь к администратору центра.");
  const body = await readJson(request);
  const appointmentId = stringValue(body, "appointmentId");
  const rating = numberValue(body, "rating");
  if (!appointmentId || !Number.isInteger(rating) || rating < 1 || rating > 5) return badRequest("Выберите оценку от 1 до 5");
  const appointment = await env.DB.prepare("SELECT id FROM appointments WHERE id = ? AND client_id = ? AND status = 'COMPLETED'").bind(appointmentId, user.clientId).first();
  if (!appointment) return badRequest("Отзыв можно оставить только после завершённого приёма");
  const id = newId();
  try {
    await env.DB.prepare("INSERT INTO client_reviews (id, client_id, appointment_id, rating, review_text) VALUES (?, ?, ?, ?, ?)").bind(id, user.clientId, appointmentId, rating, stringValue(body, "reviewText").slice(0, 2000) || null).run();
  } catch {
    return badRequest("Для этой записи отзыв уже оставлен");
  }
  return json({ ok: true, id }, 201);
};
