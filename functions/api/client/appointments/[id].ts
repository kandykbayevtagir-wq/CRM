import { forbidden, getSessionUser, isClient, unauthorized } from "../../../_lib/auth";
import type { CrmEnv } from "../../../_lib/env";
import { badRequest, json, newId, readJson, stringValue } from "../../../_lib/http";

export const onRequestPatch: PagesFunction<CrmEnv> = async (context) => {
  const { request, env, params } = context;
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isClient(user)) return forbidden();
  if (!user.clientId) return badRequest("Сначала заполните профиль клиента");
  const appointmentId = Array.isArray(params.id) ? params.id[0] : params.id;
  if (!appointmentId) return badRequest("Запись не найдена");
  const existing = await env.DB.prepare("SELECT id, status, starts_at AS startsAt FROM appointments WHERE id = ? AND client_id = ?").bind(appointmentId, user.clientId).first<{ id: string; status: string; startsAt: string }>();
  if (!existing) return badRequest("Запись не найдена");
  if (!["SCHEDULED", "CONFIRMED"].includes(existing.status)) return badRequest("Эту запись уже нельзя отменить");
  const settings = await env.DB.prepare("SELECT cancellation_window_hours AS hours FROM organization_settings WHERE id = 1").first<{ hours: number }>();
  if (new Date(existing.startsAt).getTime() - Date.now() < Number(settings?.hours ?? 2) * 60 * 60_000) return badRequest(`Отменить запись можно не позднее чем за ${settings?.hours ?? 2} часа`);
  const body = await readJson(request);
  const reason = stringValue(body, "reason", "Отменено клиентом");
  await env.DB.batch([
    env.DB.prepare("UPDATE appointments SET status = 'CANCELLED', cancel_reason = ?, cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(reason, appointmentId),
    env.DB.prepare("INSERT INTO appointment_status_history (id, appointment_id, from_status, to_status, actor_id, note) VALUES (?, ?, ?, 'CANCELLED', ?, ?)").bind(newId(), appointmentId, existing.status, user.id, reason),
  ]);
  const notificationId = newId();
  await env.DB.prepare("UPDATE notifications SET status = 'CANCELLED' WHERE appointment_id = ? AND status = 'PENDING'").bind(appointmentId).run();
  await env.DB.prepare("INSERT INTO notifications (id, user_id, client_id, appointment_id, kind, scheduled_at, payload_json) VALUES (?, ?, ?, ?, 'BOOKING_CANCELLED', CURRENT_TIMESTAMP, ?)").bind(notificationId, user.id, user.clientId, appointmentId, JSON.stringify({ reason })).run();
  await env.DB.prepare("INSERT OR IGNORE INTO message_outbox (id, event_key, telegram_id, template_key, payload_json) VALUES (?, ?, ?, 'BOOKING_CANCELLED', ?)")
    .bind(newId(), `appointment:${appointmentId}:cancelled:${existing.status}`, user.telegramId, JSON.stringify({ date: new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "Asia/Almaty" }).format(new Date(existing.startsAt)), time: new Intl.DateTimeFormat("ru-RU", { timeStyle: "short", timeZone: "Asia/Almaty" }).format(new Date(existing.startsAt)), message: reason }))
    .run();
  return json({ ok: true });
};
