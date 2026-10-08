import { scheduleConflict } from "../../_lib/schedule";
import { auditStatement } from "../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { prepareAppointmentConsumption } from "../../_lib/inventory";
import { loyaltyAwardStatement } from "../../_lib/loyalty";
import { reservationStatements, appointmentReminderStatements } from "../../_lib/booking";
import { assertUnchanged } from "../../_lib/transaction";
import { badRequest, conflict, json, newId, notFound, optionalString, readJson, stringValue } from "../../_lib/http";
import { normalizeIso, organizationTimezone, zonedDateValue } from "../../_lib/dates";
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
  if (typeof body.revision === "number" && body.revision !== Number(existing.revision)) return conflict("Запись уже изменилась. Обновите экран.");
  const previousStatus = String(existing.status ?? "SCHEDULED").toUpperCase();
  const requestedStatus = stringValue(body, "status", previousStatus).toUpperCase();
  if (!isAppointmentStatus(requestedStatus)) return badRequest("Некорректный статус записи");
  const administrativeOverride = false;
  if (!canTransitionAppointment(previousStatus, requestedStatus, administrativeOverride)) return badRequest(`Нельзя перевести запись из ${previousStatus} в ${requestedStatus}`);

  // Stored timestamps may be legacy "YYYY-MM-DD HH:MM:SS" (UTC) or ISO; compare instants, not strings.
  const timezone = await organizationTimezone(env.DB);
  const existingStarts = normalizeIso(existing.starts_at);
  const existingEnds = normalizeIso(existing.ends_at);
  const previousStarts = Date.parse(existingStarts);
  const previousEnds = Date.parse(existingEnds);
  const duration = Number.isFinite(previousStarts) && Number.isFinite(previousEnds) && previousEnds > previousStarts ? previousEnds - previousStarts : 60 * 60_000;
  const requestedStarts = zonedDateValue(body, "startsAt", timezone);
  const requestedEnds = zonedDateValue(body, "endsAt", timezone);
  if ((stringValue(body, "startsAt") && !requestedStarts) || (stringValue(body, "endsAt") && !requestedEnds)) return badRequest("Некорректный интервал записи");
  const incomingDate = requestedStarts || existingStarts;
  const incomingEnds = requestedEnds || (requestedStarts ? new Date(Date.parse(requestedStarts) + duration).toISOString() : existingEnds || new Date(Date.parse(incomingDate) + duration).toISOString());
  const employeeId = optionalString(body, "employeeId") ?? String(existing.employee_id ?? "");
  const branchId = optionalString(body, "branchId") ?? String(existing.branch_id ?? "");
  if (!Number.isFinite(Date.parse(incomingDate)) || !Number.isFinite(Date.parse(incomingEnds)) || Date.parse(incomingEnds) <= Date.parse(incomingDate)) return badRequest("Некорректный интервал записи");
  if (user.role === "SPECIALIST" && employeeId !== ownEmployee?.id) return forbidden("Специалист не может переназначить запись другому сотруднику");

  const moved = Date.parse(incomingDate) !== previousStarts || (Number.isFinite(previousEnds) && Date.parse(incomingEnds) !== previousEnds) || employeeId !== String(existing.employee_id ?? "") || branchId !== String(existing.branch_id ?? "");
  if (moved) {
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
  }
  if (moved && previousStatus === "COMPLETED") return badRequest("Время и специалист завершённого приёма зафиксированы");
  if (moved) {
    const scheduleError = await scheduleConflict(env.DB, employeeId, branchId, incomingDate, incomingEnds);
    if (scheduleError) return badRequest(scheduleError);
  }
  if (moved || !["CANCELLED", "NO_SHOW"].includes(previousStatus)) {
    const overlapping = await env.DB.prepare(`
      SELECT id FROM appointments WHERE id <> ? AND employee_id = ? AND status NOT IN ('CANCELLED', 'NO_SHOW')
        AND julianday(starts_at) < julianday(?) AND julianday(COALESCE(ends_at, datetime(starts_at, '+60 minutes'))) > julianday(?) LIMIT 1
    `).bind(appointmentId, employeeId, incomingEnds, incomingDate).first<{ id: string }>();
    if (overlapping && moved) return conflict("У специалиста уже есть пересекающаяся запись");
  }
  // Unchanged rows keep their stored timestamp text so the terminal-immutability trigger sees identical values.
  const storedStarts = moved ? incomingDate : String(existing.starts_at ?? incomingDate);
  const storedEnds = moved ? incomingEnds : (existing.ends_at === null || existing.ends_at === undefined ? null : String(existing.ends_at));

  const cancelReason = requestedStatus === "CANCELLED" || requestedStatus === "NO_SHOW"
    ? ((optionalString(body, "cancelReason", 500) ?? String(existing.cancel_reason ?? "")) || "Без причины")
    : null;
  const statements: D1PreparedStatement[] = [
    ...assertUnchanged(env.DB, "appointments", appointmentId, Number(existing.revision)),
    env.DB.prepare(`UPDATE appointments SET starts_at = ?, ends_at = ?, employee_id = ?, branch_id = ?, status = ?, notes = ?, cancel_reason = ?, cancelled_at = CASE WHEN ? IN ('CANCELLED', 'NO_SHOW') THEN COALESCE(cancelled_at, CURRENT_TIMESTAMP) ELSE NULL END, confirmed_at = CASE WHEN ? = 'CONFIRMED' THEN COALESCE(confirmed_at, CURRENT_TIMESTAMP) ELSE confirmed_at END, changed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(storedStarts, storedEnds, moved ? employeeId : existing.employee_id ?? null, moved ? branchId : existing.branch_id ?? null, requestedStatus, body.notes === null ? null : optionalString(body, "notes", 2000) ?? existing.notes ?? null, cancelReason, requestedStatus, requestedStatus, user.id, appointmentId),
    env.DB.prepare("INSERT INTO appointment_status_history (id, appointment_id, from_status, to_status, actor_id, note) VALUES (?, ?, ?, ?, ?, ?)").bind(newId(), appointmentId, previousStatus, requestedStatus, user.id, cancelReason),
    auditStatement(env.DB, user, "appointment", appointmentId, "UPDATE", { status: previousStatus, startsAt: existing.starts_at, endsAt: existing.ends_at }, { status: requestedStatus, startsAt: incomingDate, endsAt: incomingEnds, cancelReason }),
  ];
  if (moved || ["CANCELLED", "NO_SHOW"].includes(requestedStatus)) statements.push(env.DB.prepare("DELETE FROM appointment_slot_reservations WHERE appointment_id = ?").bind(appointmentId));
  const shouldNotifyClient = previousStatus !== requestedStatus && ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(requestedStatus);
  const clientRecipient = shouldNotifyClient ? await env.DB.prepare(`
    SELECT u.telegram_id AS telegramId, c.full_name AS clientName, e.full_name AS specialist, b.name AS branch,
      (SELECT s.name FROM appointment_services aps INNER JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id LIMIT 1) AS service
    FROM appointments a INNER JOIN clients c ON c.id = a.client_id
    INNER JOIN users u ON u.client_id = c.id AND u.active = 1 AND u.notifications_allowed = 1
    LEFT JOIN employees e ON e.id = a.employee_id LEFT JOIN branches b ON b.id = a.branch_id
    WHERE a.id = ? LIMIT 1
  `).bind(appointmentId).first<{ telegramId: string; clientName: string; specialist: string | null; branch: string | null; service: string | null }>() : null;
  if (clientRecipient) {
    const startsAt = new Date(incomingDate);
    statements.push(env.DB.prepare("INSERT OR IGNORE INTO message_outbox (id, event_key, telegram_id, template_key, payload_json) VALUES (?, ?, ?, ?, ?)")
      .bind(newId(), `appointment:${appointmentId}:status:${requestedStatus}`, clientRecipient.telegramId, requestedStatus === "COMPLETED" ? "VISIT_COMPLETED" : "BOOKING_CANCELLED", JSON.stringify({ clientName: clientRecipient.clientName, date: new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: timezone }).format(startsAt), time: new Intl.DateTimeFormat("ru-RU", { timeStyle: "short", timeZone: timezone }).format(startsAt), specialist: clientRecipient.specialist ?? "Специалист", service: clientRecipient.service ?? "Приём", branch: clientRecipient.branch ?? "Филиал", message: requestedStatus === "NO_SHOW" ? "Визит отмечен как неявка." : (cancelReason ?? "" ) })));
  }
  const inventory = requestedStatus === "COMPLETED" && previousStatus !== "COMPLETED"
    ? await prepareAppointmentConsumption(env.DB, appointmentId, user.id)
    : { statements: [] as D1PreparedStatement[], warnings: [] };
  statements.push(...inventory.statements);
  if (requestedStatus === "COMPLETED" && previousStatus !== "COMPLETED") statements.push(loyaltyAwardStatement(env.DB, appointmentId));
  if (requestedStatus === "CANCELLED" || requestedStatus === "NO_SHOW" || moved) statements.push(env.DB.prepare("UPDATE notifications SET status = 'CANCELLED' WHERE appointment_id = ? AND status = 'PENDING'").bind(appointmentId));
  if (moved && ["SCHEDULED","CONFIRMED"].includes(requestedStatus)) {
    statements.push(...appointmentReminderStatements(env.DB,appointmentId,String(existing.client_id),incomingDate));
    statements.push(env.DB.prepare(`INSERT OR IGNORE INTO message_outbox(id,event_key,telegram_id,template_key,payload_json)
      SELECT ?, ?, u.telegram_id, 'BOOKING_CHANGED', json_object('appointmentId',a.id,'startsAt',a.starts_at,
        'clientName',c.full_name,'specialist',e.full_name,'branch',b.name,'timezone',os.timezone,
        'service',(SELECT group_concat(s.name, ', ') FROM appointment_services aps JOIN services s ON s.id=aps.service_id WHERE aps.appointment_id=a.id))
      FROM appointments a JOIN clients c ON c.id=a.client_id JOIN users u ON u.client_id=c.id AND u.active=1 AND u.notifications_allowed=1
      LEFT JOIN employees e ON e.id=a.employee_id LEFT JOIN branches b ON b.id=a.branch_id CROSS JOIN organization_settings os
      WHERE a.id=? AND os.id=1`).bind(newId(),`appointment:${appointmentId}:changed:${Number(existing.revision)+1}`,appointmentId));
  }
  const followUpDaysValue = typeof body.followUpDays === "number" ? body.followUpDays : Number(body.followUpDays);
  const followUpDate = zonedDateValue(body, "followUpDate", timezone);
  if (requestedStatus === "COMPLETED" && previousStatus !== "COMPLETED" && ((Number.isFinite(followUpDaysValue) && followUpDaysValue > 0) || followUpDate)) {
    const recommendedDate = followUpDate || new Date(Date.now() + followUpDaysValue * 86_400_000).toISOString();
    statements.push(env.DB.prepare("UPDATE follow_ups SET status = 'DONE', completed_at = CURRENT_TIMESTAMP, completed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE client_id = ? AND status = 'OPEN'").bind(user.id, String(existing.client_id ?? "")));
    statements.push(env.DB.prepare("INSERT INTO follow_ups (id, client_id, appointment_id, recommended_date, interval_days, assigned_to, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(newId(), String(existing.client_id ?? ""), appointmentId, recommendedDate, Number.isFinite(followUpDaysValue) && followUpDaysValue > 0 ? followUpDaysValue : null, user.id, user.id));
  }
  if (moved && !['CANCELLED', 'NO_SHOW'].includes(requestedStatus)) statements.push(...reservationStatements(env.DB, appointmentId, employeeId, incomingDate, incomingEnds));
  try {
    await env.DB.batch(statements);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    if (/mutation_precondition/i.test(message)) return conflict("Запись уже изменилась. Обновите календарь и повторите действие.");
    if (/CRM_SLOT_UNAVAILABLE|unique|constraint|appointment_slot_reservations|idx_appointments_active_employee_start/i.test(message)) return conflict("У специалиста уже есть пересекающаяся запись");
    return json({ ok: false, error: "Не удалось сохранить изменения записи. Попробуйте ещё раз." }, 500);
  }
  return json({ ok: true, inventoryWarnings: inventory.warnings });
};
