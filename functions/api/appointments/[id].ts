import { auditStatement } from "../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { awardLoyaltyPoints } from "../../_lib/loyalty";
import { reservationStatements } from "../../_lib/booking";
import { badRequest, conflict, dateValue, json, newId, notFound, optionalString, readJson, stringValue } from "../../_lib/http";
import { canTransitionAppointment, isAppointmentStatus } from "../../../src/lib/appointments/transitions";

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "appointments.write")) return forbidden();
  const appointmentId = Array.isArray(params.id) ? params.id[0] : params.id;
  if (!appointmentId) return notFound("Запись не найдена");
  const existing = await env.DB.prepare("SELECT * FROM appointments WHERE id = ?").bind(appointmentId).first<Record<string, unknown>>();
  if (!existing) return notFound("Запись не найдена");
  const ownEmployee = user.role === "SPECIALIST"
    ? await env.DB.prepare("SELECT id FROM employees WHERE user_id = ? AND is_active = 1 LIMIT 1").bind(user.id).first<{ id: string }>()
    : null;
  if (user.role === "SPECIALIST" && (!ownEmployee || String(existing.employee_id ?? "") !== ownEmployee.id)) return forbidden("Специалист может изменять только свои записи");

  const body = await readJson(request);
  const previousStatus = String(existing.status ?? "SCHEDULED").toUpperCase();
  const requestedStatus = stringValue(body, "status", previousStatus).toUpperCase();
  if (!isAppointmentStatus(requestedStatus)) return badRequest("Некорректный статус записи");
  const administrativeOverride = user.role === "OWNER" && body.administrativeOverride === true;
  if (!canTransitionAppointment(previousStatus, requestedStatus, administrativeOverride)) return badRequest(`Нельзя перевести запись из ${previousStatus} в ${requestedStatus}`);

  const incomingDate = dateValue(body, "startsAt") || String(existing.starts_at ?? "");
  const employeeId = optionalString(body, "employeeId") ?? String(existing.employee_id ?? "");
  const branchId = optionalString(body, "branchId") ?? String(existing.branch_id ?? "");
  const previousStarts = new Date(String(existing.starts_at ?? "")).getTime();
  const previousEnds = new Date(String(existing.ends_at ?? "")).getTime();
  const duration = Number.isFinite(previousStarts) && Number.isFinite(previousEnds) && previousEnds > previousStarts ? previousEnds - previousStarts : 60 * 60_000;
  const incomingEnds = dateValue(body, "endsAt") || new Date(new Date(incomingDate).getTime() + duration).toISOString();
  if (!Number.isFinite(new Date(incomingDate).getTime()) || !Number.isFinite(new Date(incomingEnds).getTime()) || new Date(incomingEnds).getTime() <= new Date(incomingDate).getTime()) return badRequest("Некорректный интервал записи");
  if (user.role === "SPECIALIST" && employeeId !== ownEmployee?.id) return forbidden("Специалист не может переназначить запись другому сотруднику");

  const employee = await env.DB.prepare("SELECT e.id FROM employees e WHERE e.id = ? AND e.is_active = 1 AND EXISTS (SELECT 1 FROM employee_branches eb WHERE eb.employee_id = e.id AND eb.branch_id = ?)").bind(employeeId, branchId).first();
  if (!employee) return badRequest("Специалист не работает в выбранном филиале");
  const serviceIds = await env.DB.prepare("SELECT service_id AS serviceId FROM appointment_services WHERE appointment_id = ?").bind(appointmentId).all<{ serviceId: string }>();
  const serviceIdsList = (serviceIds.results ?? []).map((row) => row.serviceId);
  if (serviceIdsList.length) {
    const eligible = await env.DB.prepare(`
      SELECT COUNT(DISTINCT es.service_id) AS count
      FROM employee_services es
      WHERE es.employee_id = ? AND es.active = 1 AND es.service_id IN (${serviceIdsList.map(() => "?").join(",")})
        AND (es.branch_id IS NULL OR es.branch_id = ?)
    `).bind(employeeId, ...serviceIdsList, branchId).first<{ count: number }>();
    if (Number(eligible?.count ?? 0) !== serviceIdsList.length) return badRequest("Специалист не оказывает одну из услуг в выбранном филиале");
  }
  const overlapping = await env.DB.prepare(`
    SELECT id FROM appointments WHERE id <> ? AND employee_id = ? AND status NOT IN ('CANCELLED', 'NO_SHOW')
      AND starts_at < ? AND COALESCE(ends_at, datetime(starts_at, '+60 minutes')) > ? LIMIT 1
  `).bind(appointmentId, employeeId, incomingEnds, incomingDate).first<{ id: string }>();
  if (overlapping) return conflict("У специалиста уже есть пересекающаяся запись");

  const cancelReason = requestedStatus === "CANCELLED" || requestedStatus === "NO_SHOW"
    ? ((optionalString(body, "cancelReason") ?? String(existing.cancel_reason ?? "")) || "Без причины")
    : null;
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`UPDATE appointments SET starts_at = ?, ends_at = ?, employee_id = ?, branch_id = ?, status = ?, notes = ?, cancel_reason = ?, cancelled_at = CASE WHEN ? IN ('CANCELLED', 'NO_SHOW') THEN COALESCE(cancelled_at, CURRENT_TIMESTAMP) ELSE NULL END, confirmed_at = CASE WHEN ? = 'CONFIRMED' THEN COALESCE(confirmed_at, CURRENT_TIMESTAMP) ELSE confirmed_at END, changed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(incomingDate, incomingEnds, employeeId, branchId, requestedStatus, body.notes === null ? null : optionalString(body, "notes") ?? existing.notes ?? null, cancelReason, requestedStatus, requestedStatus, user.id, appointmentId),
    env.DB.prepare("INSERT INTO appointment_status_history (id, appointment_id, from_status, to_status, actor_id, note) VALUES (?, ?, ?, ?, ?, ?)").bind(newId(), appointmentId, previousStatus, requestedStatus, user.id, cancelReason),
    auditStatement(env.DB, user, "appointment", appointmentId, "UPDATE", { status: previousStatus, startsAt: existing.starts_at, endsAt: existing.ends_at }, { status: requestedStatus, startsAt: incomingDate, endsAt: incomingEnds, cancelReason }),
    env.DB.prepare("DELETE FROM appointment_slot_reservations WHERE appointment_id = ?").bind(appointmentId),
  ];
  if (!['CANCELLED', 'NO_SHOW'].includes(requestedStatus)) statements.push(...reservationStatements(env.DB, appointmentId, employeeId, incomingDate, incomingEnds));
  try {
    await env.DB.batch(statements);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    if (/unique|constraint|appointment_slot_reservations|idx_appointments_active_employee_start/i.test(message)) return conflict("У специалиста уже есть пересекающаяся запись");
    return json({ ok: false, error: "Не удалось сохранить изменения записи. Попробуйте ещё раз." }, 500);
  }
  if (requestedStatus === "COMPLETED" && previousStatus !== "COMPLETED") {
    const appointment = await env.DB.prepare("SELECT client_id AS clientId, total_amount AS totalAmount FROM appointments WHERE id = ?").bind(appointmentId).first<{ clientId: string; totalAmount: number }>();
    if (appointment?.clientId) await awardLoyaltyPoints(env.DB, appointmentId, appointment.clientId, Number(appointment.totalAmount || 0));
  }
  if (requestedStatus === "CANCELLED" || requestedStatus === "NO_SHOW") await env.DB.prepare("UPDATE notifications SET status = 'CANCELLED' WHERE appointment_id = ? AND status = 'PENDING'").bind(appointmentId).run();
  return json({ ok: true });
};
