import { forbidden, getSessionUser, isStaff, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, json, newCheckInToken, newId, readJson, stringValue } from "../_lib/http";

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isStaff(user)) return forbidden();
  const body = await readJson(request);
  const appointmentId = stringValue(body, "appointmentId");
  const token = stringValue(body, "token").toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (appointmentId) {
    const existing = await env.DB.prepare("SELECT id, check_in_token AS checkInToken FROM appointments WHERE id = ?").bind(appointmentId).first<{ id: string; checkInToken: string | null }>();
    if (!existing) return badRequest("Запись не найдена");
    const checkInToken = existing.checkInToken ?? newCheckInToken();
    if (!existing.checkInToken) await env.DB.prepare("UPDATE appointments SET check_in_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(checkInToken, appointmentId).run();
    return json({ ok: true, appointmentId, checkInToken });
  }

  if (!token) return badRequest("Введите код или отсканируйте QR");
  const appointment = await env.DB.prepare(`
    SELECT a.id, a.status, a.starts_at AS startsAt, c.full_name AS clientName, s.name AS serviceName
    FROM appointments a
    INNER JOIN clients c ON c.id = a.client_id
    LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
    LEFT JOIN services s ON s.id = aps.service_id
    WHERE a.check_in_token = ? LIMIT 1
  `).bind(token).first<{ id: string; status: string; startsAt: string; clientName: string; serviceName: string | null }>();
  if (!appointment) return badRequest("Код не найден или уже недействителен");
  if (!["SCHEDULED", "CONFIRMED"].includes(appointment.status)) return badRequest("Эту запись нельзя отметить как пришедшую");
  await env.DB.batch([
    env.DB.prepare("UPDATE appointments SET status = 'ARRIVED', checked_in_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(appointment.id),
    env.DB.prepare("INSERT INTO appointment_status_history (id, appointment_id, from_status, to_status, actor_id, note) VALUES (?, ?, ?, 'ARRIVED', ?, 'Check-in клиента')").bind(newId(), appointment.id, appointment.status, user.id),
  ]);
  return json({ ok: true, appointment: { id: appointment.id, clientName: appointment.clientName, serviceName: appointment.serviceName, startsAt: appointment.startsAt, status: "ARRIVED" } });
};
