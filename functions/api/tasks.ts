import { auditStatement } from "../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, dateValue, json, newId, optionalString, readJson, stringValue } from "../_lib/http";
import { getOwnEmployeeId } from "../_lib/access";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "tasks.read")) return forbidden();
  const params = new URL(request.url).searchParams;
  const filters = ["1 = 1"]; const bindings: string[] = [];
  if (user.role === "SPECIALIST") { filters.push("t.assignee_id = ?"); bindings.push(user.id); }
  if (params.get("status")) { filters.push("t.status = ?"); bindings.push(params.get("status") as string); }
  const scope = params.get("scope");
  if (scope === "mine") { filters.push("t.assignee_id = ?"); bindings.push(user.id); }
  if (scope === "today") filters.push("date(t.due_date) = date('now', 'localtime')");
  if (scope === "overdue") filters.push("t.status IN ('OPEN', 'IN_PROGRESS') AND t.due_date < CURRENT_TIMESTAMP");
  if (params.get("branchId")) { filters.push("t.branch_id = ?"); bindings.push(params.get("branchId") as string); }
  const rows = await env.DB.prepare(`SELECT t.id, t.title, t.description, t.assignee_id AS assigneeId, au.name AS assigneeName, t.creator_id AS creatorId, cu.name AS creatorName, t.client_id AS clientId, c.full_name AS clientName, t.appointment_id AS appointmentId, t.branch_id AS branchId, b.name AS branchName, t.due_date AS dueDate, t.priority, t.status, t.completed_at AS completedAt, t.created_at AS createdAt FROM tasks t LEFT JOIN users au ON au.id = t.assignee_id LEFT JOIN users cu ON cu.id = t.creator_id LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN branches b ON b.id = t.branch_id WHERE ${filters.join(" AND ")} ORDER BY CASE t.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 ELSE 4 END, t.due_date ASC LIMIT 500`).bind(...bindings).all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "tasks.write")) return forbidden();
  const body = await readJson(request);
  const title = stringValue(body, "title");
  const priority = stringValue(body, "priority", "NORMAL").toUpperCase();
  if (!title || !["LOW", "NORMAL", "HIGH", "URGENT"].includes(priority)) return badRequest("Укажите название и корректный приоритет");
  const ownEmployeeId = await getOwnEmployeeId(env.DB, user);
  const requestedAssignee = optionalString(body, "assigneeId");
  const requestedClient = optionalString(body, "clientId");
  const requestedAppointment = optionalString(body, "appointmentId");
  if (user.role === "SPECIALIST") {
    if (!ownEmployeeId) return forbidden("Профиль специалиста не привязан к сотруднику");
    if (requestedAssignee && requestedAssignee !== user.id) return forbidden("Специалист может назначать задачи только себе");
    if (requestedClient && !requestedAppointment) return forbidden("Задача специалиста должна быть связана с его записью");
    if (requestedAppointment && !await env.DB.prepare("SELECT id FROM appointments WHERE id = ? AND employee_id = ? AND (? IS NULL OR client_id = ?)").bind(requestedAppointment, ownEmployeeId, requestedClient, requestedClient).first()) return forbidden("Задача может быть связана только с вашей записью и клиентом");
  }
  const id = newId();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO tasks (id, title, description, assignee_id, creator_id, client_id, appointment_id, branch_id, due_date, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, title, optionalString(body, "description"), user.role === "SPECIALIST" ? user.id : requestedAssignee, user.id, optionalString(body, "clientId"), requestedAppointment, optionalString(body, "branchId"), dateValue(body, "dueDate") || null, priority),
    auditStatement(env.DB, user, "task", id, "CREATE", null, { title, priority }),
  ]);
  return json({ ok: true, id }, 201);
};
