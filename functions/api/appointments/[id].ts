import { forbidden, getSessionUser, isStaff, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { awardLoyaltyPoints } from "../../_lib/loyalty";
import { badRequest, dateValue, json, newId, numberValue, notFound, optionalString, readJson, stringValue } from "../../_lib/http";

const statuses = new Set(["SCHEDULED", "CONFIRMED", "ARRIVED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"]);

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isStaff(user)) return forbidden();
  const appointmentId = Array.isArray(params.id) ? params.id[0] : params.id;
  if (!appointmentId) return notFound("Запись не найдена");
  const existing = await env.DB.prepare("SELECT * FROM appointments WHERE id = ?").bind(appointmentId).first();
  if (!existing) return notFound("Запись не найдена");
  const body = await readJson(request);
  const rawStatus = stringValue(body, "status", String(existing.status ?? "SCHEDULED")).toUpperCase();
  if (!statuses.has(rawStatus)) return badRequest("Некорректный статус записи");
  const incomingDate = dateValue(body, "startsAt");
  const previousStatus = String(existing.status ?? "SCHEDULED");
  const cancelReason = optionalString(body, "cancelReason") ?? existing.cancel_reason ?? null;
  await env.DB.prepare(`
    UPDATE appointments
    SET starts_at = ?, employee_id = ?, branch_id = ?, status = ?, total_amount = ?, notes = ?,
      cancel_reason = ?, cancelled_at = CASE WHEN ? IN ('CANCELLED', 'NO_SHOW') THEN COALESCE(cancelled_at, CURRENT_TIMESTAMP) ELSE NULL END,
      confirmed_at = CASE WHEN ? = 'CONFIRMED' THEN COALESCE(confirmed_at, CURRENT_TIMESTAMP) ELSE confirmed_at END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    incomingDate || existing.starts_at,
    optionalString(body, "employeeId") ?? existing.employee_id ?? null,
    optionalString(body, "branchId") ?? existing.branch_id ?? null,
    rawStatus,
    numberValue(body, "totalAmount", Number(existing.total_amount ?? 0)),
    optionalString(body, "notes") ?? existing.notes ?? null,
    cancelReason,
    rawStatus,
    rawStatus,
    appointmentId,
  ).run();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO appointment_status_history (id, appointment_id, from_status, to_status, actor_id, note) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(newId(), appointmentId, previousStatus, rawStatus, user.id, cancelReason),
    env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action, after_json) VALUES (?, ?, 'appointment', ?, 'UPDATE', ?)")
      .bind(newId(), user.id, appointmentId, JSON.stringify({ status: rawStatus })),
  ]);
  if (rawStatus === "COMPLETED" && previousStatus !== "COMPLETED") {
    const appointment = await env.DB.prepare("SELECT client_id AS clientId, total_amount AS totalAmount FROM appointments WHERE id = ?").bind(appointmentId).first<{ clientId: string; totalAmount: number }>();
    if (appointment?.clientId) await awardLoyaltyPoints(env.DB, appointmentId, appointment.clientId, Number(appointment.totalAmount || 0));
  }
  return json({ ok: true });
};
