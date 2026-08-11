import { auditStatement } from "../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, dateValue, json, notFound, readJson, stringValue } from "../../_lib/http";

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "retention.write")) return forbidden();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const existing = await env.DB.prepare("SELECT * FROM follow_ups WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!existing) return notFound("Follow-up не найден");
  const body = await readJson(request);
  const status = stringValue(body, "status", String(existing.status ?? "OPEN")).toUpperCase();
  if (!["OPEN", "BOOKED", "DONE", "CANCELLED"].includes(status)) return badRequest("Некорректный статус follow-up");
  await env.DB.batch([
    env.DB.prepare("UPDATE follow_ups SET status = ?, recommended_date = ?, completed_at = CASE WHEN ? IN ('DONE', 'BOOKED') THEN COALESCE(completed_at, CURRENT_TIMESTAMP) ELSE completed_at END, completed_by = CASE WHEN ? IN ('DONE', 'BOOKED') THEN ? ELSE completed_by END, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(status, dateValue(body, "recommendedDate") || existing.recommended_date, status, status, user.id, id),
    auditStatement(env.DB, user, "follow_up", id, "UPDATE", { status: existing.status }, { status }),
  ]);
  return json({ ok: true });
};
