import { auditStatement } from "../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, json, newId, optionalString, readJson, stringValue } from "../_lib/http";
import { isoColumn, organizationTimezone, timezoneOffsetMinutes, zonedDateValue } from "../_lib/dates";
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
  if (scope === "today") filters.push("date(julianday(t.due_date) + ?) = date(julianday('now') + ?)");
  if (scope === "overdue") filters.push("t.status IN ('OPEN', 'IN_PROGRESS') AND julianday(t.due_date) < julianday('now')");
  if (params.get("branchId")) { filters.push("t.branch_id = ?"); bindings.push(params.get("branchId") as string); }
  const dayOffset = (timezoneOffsetMinutes(new Date().toISOString().slice(0, 10), await organizationTimezone(env.DB)) / 1440).toFixed(6);
  if (scope === "today") bindings.push(dayOffset, dayOffset);
  const rows = await env.DB.prepare(`SELECT t.id, t.title, t.description, t.assignee_id AS assigneeId, au.name AS assigneeName, t.creator_id AS creatorId, cu.name AS creatorName, t.client_id AS clientId, c.full_name AS clientName, t.appointment_id AS appointmentId, t.branch_id AS branchId, b.name AS branchName, ${isoColumn("t.due_date")} AS dueDate, t.priority, t.status, t.completed_at AS completedAt, t.created_at AS createdAt FROM tasks t LEFT JOIN users au ON au.id = t.assignee_id LEFT JOIN users cu ON cu.id = t.creator_id LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN branches b ON b.id = t.branch_id WHERE ${filters.join(" AND ")} ORDER BY CASE t.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 ELSE 4 END, julianday(t.due_date) ASC LIMIT 500`).bind(...bindings).all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "tasks.write")) return forbidden();
  const body = await readJson(request);
  const title = stringValue(body, "title").slice(0, 200);
  const priority = stringValue(body, "priority", "NORMAL").toUpperCase();
  if (!title || !["LOW", "NORMAL", "HIGH", "URGENT"].includes(priority)) return badRequest("Укажите название и корректный приоритет");
  const timezone = await organizationTimezone(env.DB);
  const dueDate = zonedDateValue(body, "dueDate", timezone) || null;
  if (stringValue(body, "dueDate") && !dueDate) return badRequest("Некорректный срок задачи");
  const ownEmployeeId = await getOwnEmployeeId(env.DB, user);
  const requestedAssignee = optionalString(body, "assigneeId");
  const requestedClient = optionalString(body, "clientId");
  const requestedAppointment = optionalString(body, "appointmentId");
  const branchId = optionalString(body, "branchId") || null;
  if (branchId && !await env.DB.prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1").bind(branchId).first()) return badRequest("Филиал не найден");
  if (requestedAssignee && user.role !== "SPECIALIST" && !await env.DB.prepare("SELECT id FROM users WHERE id = ? AND active = 1 AND role <> 'CLIENT'").bind(requestedAssignee).first()) return badRequest("Исполнитель не найден");
  if (requestedClient && user.role !== "SPECIALIST" && !await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(requestedClient).first()) return badRequest("Клиент не найден");
  if (user.role === "SPECIALIST") {
    if (!ownEmployeeId) return forbidden("Профиль специалиста не привязан к сотруднику");
    if (requestedAssignee && requestedAssignee !== user.id) return forbidden("Специалист может назначать задачи только себе");
    if (requestedClient && !requestedAppointment) return forbidden("Задача специалиста должна быть связана с его записью");
    if (requestedAppointment && !await env.DB.prepare("SELECT id FROM appointments WHERE id = ? AND employee_id = ? AND (? IS NULL OR client_id = ?)").bind(requestedAppointment, ownEmployeeId, requestedClient, requestedClient).first()) return forbidden("Задача может быть связана только с вашей записью и клиентом");
  }
  const id = newId();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO tasks (id, title, description, assignee_id, creator_id, client_id, appointment_id, branch_id, due_date, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, title, optionalString(body, "description", 2000), user.role === "SPECIALIST" ? user.id : requestedAssignee, user.id, requestedClient, requestedAppointment, branchId, dueDate, priority),
    auditStatement(env.DB, user, "task", id, "CREATE", null, { title, priority }),
  ]);
  return json({ ok: true, id }, 201);
};
