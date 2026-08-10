import { getSessionUser, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, dateValue, json, newId, numberValue, notFound, optionalString, readJson, stringValue } from "../../_lib/http";

const statuses = new Set(["SCHEDULED", "CONFIRMED", "ARRIVED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"]);

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  const existing = await env.DB.prepare("SELECT * FROM appointments WHERE id = ?").bind(params.id).first();
  if (!existing) return notFound("Запись не найдена");
  const body = await readJson(request);
  const rawStatus = stringValue(body, "status", String(existing.status ?? "SCHEDULED")).toUpperCase();
  if (!statuses.has(rawStatus)) return badRequest("Некорректный статус записи");
  const incomingDate = dateValue(body, "startsAt");
  await env.DB.prepare(`
    UPDATE appointments
    SET starts_at = ?, employee_id = ?, branch_id = ?, status = ?, total_amount = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    incomingDate || existing.starts_at,
    optionalString(body, "employeeId") ?? existing.employee_id ?? null,
    optionalString(body, "branchId") ?? existing.branch_id ?? null,
    rawStatus,
    numberValue(body, "totalAmount", Number(existing.total_amount ?? 0)),
    optionalString(body, "notes") ?? existing.notes ?? null,
    params.id,
  ).run();
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action, after_json) VALUES (?, ?, 'appointment', ?, 'UPDATE', ?)")
    .bind(newId(), user.id, params.id, JSON.stringify({ status: rawStatus })).run();
  return json({ ok: true });
};
