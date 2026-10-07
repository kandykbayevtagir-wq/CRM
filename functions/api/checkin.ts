import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import { getOwnEmployeeId } from "../_lib/access";
import type { CrmEnv } from "../_lib/env";
import { assertUnchanged } from "../_lib/transaction";
import { badRequest, json, newCheckInToken, newId, readJson, stringValue } from "../_lib/http";

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "appointments.write")) return forbidden();
  const body = await readJson(request);
  const appointmentId = stringValue(body, "appointmentId");
  const token = stringValue(body, "token").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!appointmentId && !token) return badRequest("Введите код клиента");
  const ownId = await getOwnEmployeeId(env.DB, user);
  const appointment = await env.DB.prepare(`SELECT a.id, a.revision, a.employee_id AS employeeId, a.status, a.check_in_token AS checkInToken,
    a.starts_at AS startsAt, c.full_name AS clientName,
    (SELECT group_concat(s.name, ', ') FROM appointment_services aps JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id) AS serviceName
    FROM appointments a JOIN clients c ON c.id = a.client_id WHERE ${appointmentId ? "a.id" : "a.check_in_token"} = ?`)
    .bind(appointmentId || token).first<{ id: string; revision: number; employeeId: string; status: string; checkInToken: string | null; startsAt: string; clientName: string; serviceName: string | null }>();
  if (!appointment) return badRequest("Код или запись не найдены");
  if (user.role === "SPECIALIST" && (!ownId || appointment.employeeId !== ownId)) return forbidden("Специалист может отмечать только своих клиентов");
  if (appointmentId) {
    if (!["SCHEDULED","CONFIRMED"].includes(appointment.status)) return badRequest("Код доступен только для предстоящей записи");
    const checkInToken = appointment.checkInToken || newCheckInToken();
    if (!appointment.checkInToken) await env.DB.batch([
      ...assertUnchanged(env.DB,"appointments",appointment.id,appointment.revision),
      env.DB.prepare("UPDATE appointments SET check_in_token = ? WHERE id = ?").bind(checkInToken,appointment.id),
    ]);
    return json({ ok: true, appointmentId: appointment.id, checkInToken });
  }
  if (appointment.status === "ARRIVED") return json({ ok: true, appointment: { ...appointment, checkInToken: undefined }, replayed: true });
  if (!["SCHEDULED","CONFIRMED"].includes(appointment.status)) return badRequest("Эту запись нельзя отметить как пришедшую");
  await env.DB.batch([
    ...assertUnchanged(env.DB,"appointments",appointment.id,appointment.revision),
    env.DB.prepare("UPDATE appointments SET status = 'ARRIVED', checked_in_at = CURRENT_TIMESTAMP, changed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(user.id, appointment.id),
    env.DB.prepare("INSERT INTO appointment_status_history (id, appointment_id, from_status, to_status, actor_id, note) VALUES (?, ?, ?, 'ARRIVED', ?, 'Check-in клиента')").bind(newId(), appointment.id, appointment.status, user.id),
    env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action, after_json) VALUES (?, ?, 'appointment', ?, 'CHECK_IN', ?)").bind(newId(), user.id, appointment.id, JSON.stringify({ status: "ARRIVED" })),
  ]);
  return json({ ok: true, appointment: { id: appointment.id, clientName: appointment.clientName, serviceName: appointment.serviceName, startsAt: appointment.startsAt, status: "ARRIVED" } });
};
