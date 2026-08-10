import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { json } from "../_lib/http";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "audit.read")) return forbidden();
  const params = new URL(request.url).searchParams;
  const entityType = params.get("entityType")?.trim() ?? "";
  const limit = Math.min(500, Math.max(1, Number(params.get("limit") ?? "100") || 100));
  const query = entityType ? "WHERE entity_type = ?" : "";
  const rows = await env.DB.prepare(`SELECT l.id, l.actor_id AS actorId, u.name AS actorName, l.entity_type AS entityType, l.entity_id AS entityId, l.action, l.before_json AS beforeJson, l.after_json AS afterJson, l.created_at AS createdAt FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id ${query} ORDER BY l.created_at DESC LIMIT ?`).bind(...(entityType ? [entityType, limit] : [limit])).all();
  return json({ ok: true, items: rows.results ?? [] });
};
