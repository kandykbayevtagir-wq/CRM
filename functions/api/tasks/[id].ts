import { auditStatement } from "../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, dateValue, json, notFound, optionalString, readJson, stringValue } from "../../_lib/http";

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "tasks.write")) return forbidden();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const existing = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!existing) return notFound("Задача не найдена");
  if (user.role === "SPECIALIST" && existing.assignee_id !== user.id) return forbidden("Специалист может изменять только свои задачи");
  const body = await readJson(request);
  const status = stringValue(body, "status", String(existing.status ?? "OPEN")).toUpperCase();
  const priority = stringValue(body, "priority", String(existing.priority ?? "NORMAL")).toUpperCase();
  if (!["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"].includes(status) || !["LOW", "NORMAL", "HIGH", "URGENT"].includes(priority)) return badRequest("Некорректный статус или приоритет");
  if (user.role === "SPECIALIST" && optionalString(body, "assigneeId") && optionalString(body, "assigneeId") !== user.id) return forbidden("Специалист может назначать задачу только себе");
  await env.DB.batch([
    env.DB.prepare("UPDATE tasks SET title = ?, description = ?, assignee_id = ?, due_date = ?, priority = ?, status = ?, completed_at = CASE WHEN ? = 'DONE' THEN COALESCE(completed_at, CURRENT_TIMESTAMP) ELSE NULL END, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(stringValue(body, "title", String(existing.title ?? "")), optionalString(body, "description") ?? existing.description ?? null, user.role === "SPECIALIST" ? user.id : optionalString(body, "assigneeId") ?? existing.assignee_id ?? null, dateValue(body, "dueDate") || existing.due_date || null, priority, status, status, id),
    auditStatement(env.DB, user, "task", id, "UPDATE", { status: existing.status }, { status, priority }),
  ]);
  return json({ ok: true });
};
