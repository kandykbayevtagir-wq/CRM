import { forbidden, getSessionUser, isClient, unauthorized } from "../../_lib/auth";
import { findAvailableSlots } from "../../_lib/availability";
import { reservationStatements } from "../../_lib/booking";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, conflict, dateValue, json, newCheckInToken, newId, readJson, stringValue } from "../../_lib/http";
import { sendTelegramMessage } from "../../_lib/telegram-bot";

function appointmentMessage(clientName: string, startsAt: string, serviceName: string, branchName: string, changed = false) {
  const date = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Almaty" }).format(new Date(startsAt));
  return `${changed ? "🔄 Запись перенесена" : "✅ Запись подтверждена"}\n\n${serviceName}\n${date}\n${branchName}\n\n${clientName}, если планы изменятся, запись можно перенести в Mini App.`;
}

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isClient(user)) return forbidden();
  if (!user.clientId) return json({ ok: true, items: [] });
  const rows = await env.DB.prepare(`
    SELECT a.id, a.starts_at AS startsAt, a.status, a.total_amount AS amount, a.notes,
      c.full_name AS clientName, c.phone AS clientPhone,
      (SELECT aps.service_id FROM appointment_services aps WHERE aps.appointment_id = a.id LIMIT 1) AS serviceId,
      (SELECT s.name FROM appointment_services aps INNER JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id LIMIT 1) AS serviceName,
      a.employee_id AS employeeId, e.full_name AS employeeName, b.id AS branchId, b.name AS branchName,
      r.id AS reviewId, a.check_in_token AS checkInToken,
      CASE WHEN julianday(a.starts_at) > julianday('now', '+' || (SELECT cancellation_window_hours FROM organization_settings WHERE id = 1) || ' hours') AND a.status IN ('SCHEDULED', 'CONFIRMED') THEN 1 ELSE 0 END AS canCancel
    FROM appointments a
    INNER JOIN clients c ON c.id = a.client_id
    LEFT JOIN employees e ON e.id = a.employee_id
    LEFT JOIN branches b ON b.id = a.branch_id
    LEFT JOIN client_reviews r ON r.appointment_id = a.id
    WHERE a.client_id = ?
    ORDER BY a.starts_at DESC LIMIT 100
  `).bind(user.clientId).all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async (context) => {
  const { request, env } = context;
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isClient(user)) return forbidden();
  if (!user.clientId) return badRequest("Сначала заполните профиль клиента");
  const body = await readJson(request);
  const startsAt = dateValue(body, "startsAt");
  const serviceId = stringValue(body, "serviceId");
  const branchId = stringValue(body, "branchId");
  const employeeId = stringValue(body, "employeeId");
  const appointmentId = stringValue(body, "appointmentId");
  const idempotencyKey = stringValue(body, "idempotencyKey");
  if (!startsAt || !serviceId || !branchId || !employeeId) return badRequest("Выберите услугу, филиал, специалиста и время");
  if (idempotencyKey.length > 128) return badRequest("Некорректный ключ повторной отправки");
  const requestHash = [appointmentId, startsAt, serviceId, branchId, employeeId].join("|");
  if (idempotencyKey) {
    const previous = await env.DB.prepare("SELECT appointment_id AS appointmentId, request_hash AS requestHash, changed FROM booking_idempotency_keys WHERE idempotency_key = ? AND user_id = ? LIMIT 1")
      .bind(idempotencyKey, user.id).first<{ appointmentId: string; requestHash: string; changed: number }>();
    if (previous && previous.requestHash !== requestHash) return conflict("Этот ключ уже использован для другой записи");
    if (previous) return json({ ok: true, id: previous.appointmentId, changed: previous.changed === 1, replayed: true });
  }
  if (new Date(startsAt).getTime() <= Date.now()) return badRequest("Нельзя записаться на прошедшее время");

  const existing = appointmentId
    ? await env.DB.prepare("SELECT id, status, starts_at AS startsAt FROM appointments WHERE id = ? AND client_id = ?").bind(appointmentId, user.clientId).first<{ id: string; status: string; startsAt: string }>()
    : null;
  if (appointmentId && (!existing || ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(existing.status))) return badRequest("Эту запись уже нельзя перенести");
  const date = startsAt.slice(0, 10);
  let slots;
  try {
    slots = await findAvailableSlots(env.DB, { date, branchId, serviceId, employeeId, excludeAppointmentId: appointmentId || undefined });
  } catch (cause) {
    return badRequest(cause instanceof Error ? cause.message : "Не удалось проверить свободное окно");
  }
  const slot = slots.find((item) => item.startsAt === startsAt && item.employeeId === employeeId);
  if (!slot) return json({ ok: false, error: "Это время уже занято. Выберите другое окно.", code: "SLOT_UNAVAILABLE" }, 409);

  const service = await env.DB.prepare("SELECT name, duration_minutes AS durationMinutes FROM services WHERE id = ?").bind(serviceId).first<{ name: string; durationMinutes: number }>();
  const branch = await env.DB.prepare("SELECT name FROM branches WHERE id = ?").bind(branchId).first<{ name: string }>();
  const client = await env.DB.prepare("SELECT full_name AS fullName FROM clients WHERE id = ?").bind(user.clientId).first<{ fullName: string }>();
  if (!service || !branch || !client) return badRequest("Услуга, филиал или профиль клиента не найдены");
  const id = existing?.id ?? newId();
  const changed = Boolean(existing);
  const appointmentStatements: D1PreparedStatement[] = existing
    ? [
        env.DB.prepare("UPDATE appointments SET employee_id = ?, branch_id = ?, starts_at = ?, ends_at = ?, status = 'SCHEDULED', source = 'TELEGRAM', total_amount = ?, cancel_reason = NULL, cancelled_at = NULL, changed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(employeeId, branchId, startsAt, slot.endsAt, slot.price, user.id, id),
        env.DB.prepare("DELETE FROM appointment_services WHERE appointment_id = ?").bind(id),
        env.DB.prepare("INSERT INTO appointment_services (appointment_id, service_id, price, duration_minutes, quantity) VALUES (?, ?, ?, ?, 1)").bind(id, serviceId, slot.price, service.durationMinutes),
        env.DB.prepare("INSERT INTO appointment_status_history (id, appointment_id, from_status, to_status, actor_id, note) VALUES (?, ?, ?, 'SCHEDULED', ?, 'Клиент перенёс запись')").bind(newId(), id, existing.status, user.id),
      ]
    : [
        env.DB.prepare("INSERT INTO appointments (id, client_id, employee_id, branch_id, starts_at, ends_at, status, source, total_amount, check_in_token, created_by, changed_by) VALUES (?, ?, ?, ?, ?, ?, 'SCHEDULED', 'TELEGRAM', ?, ?, ?, ?)").bind(id, user.clientId, employeeId, branchId, startsAt, slot.endsAt, slot.price, newCheckInToken(), user.id, user.id),
        env.DB.prepare("INSERT INTO appointment_services (appointment_id, service_id, price, duration_minutes, quantity) VALUES (?, ?, ?, ?, 1)").bind(id, serviceId, slot.price, service.durationMinutes),
        env.DB.prepare("INSERT INTO appointment_status_history (id, appointment_id, from_status, to_status, actor_id, note) VALUES (?, ?, NULL, 'SCHEDULED', ?, 'Клиент создал запись')").bind(newId(), id, user.id),
      ];
  const notificationId = newId();
  const reminderTimes = [
    { kind: "REMINDER_24H", time: new Date(new Date(startsAt).getTime() - 24 * 60 * 60_000) },
    { kind: "REMINDER_2H", time: new Date(new Date(startsAt).getTime() - 2 * 60 * 60_000) },
  ].filter((reminder) => reminder.time.getTime() > Date.now());
  const notificationStatements: D1PreparedStatement[] = [
    env.DB.prepare("UPDATE notifications SET status = 'CANCELLED' WHERE appointment_id = ? AND status = 'PENDING'").bind(id),
    env.DB.prepare("INSERT INTO notifications (id, user_id, client_id, appointment_id, kind, scheduled_at, payload_json) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)")
      .bind(notificationId, user.id, user.clientId, id, changed ? "BOOKING_CHANGED" : "BOOKING_CONFIRMED", JSON.stringify({ startsAt })),
    ...reminderTimes.map((reminder) => env.DB.prepare("INSERT INTO notifications (id, user_id, client_id, appointment_id, kind, scheduled_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(newId(), user.id, user.clientId, id, reminder.kind, reminder.time.toISOString(), JSON.stringify({ startsAt }))),
  ];
  const reservationChanges: D1PreparedStatement[] = [
    env.DB.prepare("DELETE FROM appointment_slot_reservations WHERE appointment_id = ?").bind(id),
    ...reservationStatements(env.DB, id, employeeId, startsAt, slot.endsAt),
  ];
  if (user.clientId) reservationChanges.push(env.DB.prepare("UPDATE follow_ups SET status = 'BOOKED', completed_at = CURRENT_TIMESTAMP, completed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE client_id = ? AND status = 'OPEN'").bind(user.id, user.clientId));
  const idempotencyStatement = env.DB.prepare("INSERT INTO booking_idempotency_keys (idempotency_key, user_id, appointment_id, request_hash, changed) VALUES (?, ?, ?, ?, ?)")
    .bind(idempotencyKey || newId(), user.id, id, requestHash, changed ? 1 : 0);
  try {
    await env.DB.batch([...appointmentStatements, ...notificationStatements, ...reservationChanges, idempotencyStatement]);
  } catch (cause) {
    const databaseMessage = cause instanceof Error ? cause.message : "";
    if (idempotencyKey) {
      const previous = await env.DB.prepare("SELECT appointment_id AS appointmentId, request_hash AS requestHash, changed FROM booking_idempotency_keys WHERE idempotency_key = ? AND user_id = ? LIMIT 1")
        .bind(idempotencyKey, user.id).first<{ appointmentId: string; requestHash: string; changed: number }>();
      if (previous && previous.requestHash !== requestHash) return conflict("Этот ключ уже использован для другой записи");
      if (previous) return json({ ok: true, id: previous.appointmentId, changed: previous.changed === 1, replayed: true });
    }
    if (/unique|constraint|appointment_slot_reservations|idx_appointments_active_employee_start/i.test(databaseMessage)) {
      return json({ ok: false, error: "Это время только что заняли. Выберите другое окно.", code: "SLOT_UNAVAILABLE" }, 409);
    }
    return json({ ok: false, error: "Не удалось сохранить запись. Попробуйте ещё раз." }, 500);
  }
  const message = appointmentMessage(client?.fullName ?? user.name, startsAt, service?.name ?? "Приём", branch?.name ?? "Филиал", changed);
  context.waitUntil(sendTelegramMessage(env, user.telegramId, message).then(() => env.DB.prepare("UPDATE notifications SET status = 'SENT', sent_at = CURRENT_TIMESTAMP, attempts = attempts + 1 WHERE id = ?").bind(notificationId).run()).catch(() => env.DB.prepare("UPDATE notifications SET status = 'FAILED', attempts = attempts + 1 WHERE id = ?").bind(notificationId).run()));
  return json({ ok: true, id, changed }, changed ? 200 : 201);
};
