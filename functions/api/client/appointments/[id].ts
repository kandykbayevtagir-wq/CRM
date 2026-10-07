import { getActiveClientId } from "../../../_lib/access";
import { forbidden, getSessionUser, isClient, unauthorized } from "../../../_lib/auth";
import { isoColumn, organizationTimezone } from "../../../_lib/dates";
import type { CrmEnv } from "../../../_lib/env";
import { assertUnchanged } from "../../../_lib/transaction";
import { auditStatement } from "../../../_lib/audit";
import { badRequest, json, newId, notFound, readJson, stringValue } from "../../../_lib/http";

export const onRequestPatch: PagesFunction<CrmEnv> = async (context) => {
  const { request, env, params } = context;
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isClient(user)) return forbidden();
  if (!user.clientId) return badRequest("Сначала заполните профиль клиента");
  if (!await getActiveClientId(env.DB, user)) return forbidden("Карточка клиента архивирована. Обратитесь к администратору центра.");
  const appointmentId = Array.isArray(params.id) ? params.id[0] : params.id;
  if (!appointmentId) return notFound("Запись не найдена");
  const existing = await env.DB.prepare(`SELECT id, revision, status, ${isoColumn("starts_at")} AS startsAt FROM appointments WHERE id = ? AND client_id = ?`).bind(appointmentId, user.clientId).first<{ id: string; revision: number; status: string; startsAt: string }>();
  if (!existing) return notFound("Запись не найдена");
  if (!["SCHEDULED", "CONFIRMED"].includes(existing.status)) return badRequest("Эту запись уже нельзя отменить");
  const settings = await env.DB.prepare("SELECT cancellation_window_hours AS hours FROM organization_settings WHERE id = 1").first<{ hours: number }>();
  if (new Date(existing.startsAt).getTime() - Date.now() < Number(settings?.hours ?? 2) * 60 * 60_000) return badRequest(`Отменить запись можно не позднее чем за ${settings?.hours ?? 2} часа`);
  const body = await readJson(request);
  const reason = stringValue(body, "reason", "Отменено клиентом").slice(0, 500) || "Отменено клиентом";
  const timezone = await organizationTimezone(env.DB);
  await env.DB.batch([
    ...assertUnchanged(env.DB, "appointments", appointmentId, existing.revision),
    env.DB.prepare("UPDATE appointments SET status = 'CANCELLED', cancel_reason = ?, cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(reason, appointmentId),
    env.DB.prepare("INSERT INTO appointment_status_history (id, appointment_id, from_status, to_status, actor_id, note) VALUES (?, ?, ?, 'CANCELLED', ?, ?)").bind(newId(), appointmentId, existing.status, user.id, reason),
    env.DB.prepare("DELETE FROM appointment_slot_reservations WHERE appointment_id = ?").bind(appointmentId),
    env.DB.prepare("UPDATE notifications SET status = 'CANCELLED' WHERE appointment_id = ? AND status = 'PENDING'").bind(appointmentId),
    env.DB.prepare("INSERT INTO notifications (id, user_id, client_id, appointment_id, kind, status, scheduled_at, sent_at, payload_json) VALUES (?, ?, ?, ?, 'BOOKING_CANCELLED', 'SENT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)").bind(newId(), user.id, user.clientId, appointmentId, JSON.stringify({ reason })),
    env.DB.prepare("INSERT OR IGNORE INTO message_outbox (id, event_key, telegram_id, template_key, payload_json) VALUES (?, ?, ?, 'BOOKING_CANCELLED', ?)")
    .bind(newId(), `appointment:${appointmentId}:cancelled:${existing.status}`, user.telegramId, JSON.stringify({ date: new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: timezone }).format(new Date(existing.startsAt)), time: new Intl.DateTimeFormat("ru-RU", { timeStyle: "short", timeZone: timezone }).format(new Date(existing.startsAt)), message: reason }))
    ,
    auditStatement(env.DB, user, "appointment", appointmentId, "CANCEL", { status: existing.status }, { reason }),
  ]);
  return json({ ok: true });
};
