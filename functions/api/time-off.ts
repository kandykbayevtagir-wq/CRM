import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, json, newId, notFound, optionalString, readJson, stringValue } from "../_lib/http";
import { organizationTimezone, zonedDateValue } from "../_lib/dates";

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "schedules.write")) return forbidden();
  const body = await readJson(request);
  const employeeId = stringValue(body, "employeeId");
  // datetime-local values carry no zone: they are wall-clock time at the centre.
  const timezone = await organizationTimezone(env.DB);
  const startsAt = zonedDateValue(body, "startsAt", timezone);
  const endsAt = zonedDateValue(body, "endsAt", timezone);
  if (!employeeId || !startsAt || !endsAt || new Date(endsAt).getTime() <= new Date(startsAt).getTime()) return badRequest("Укажите корректный период отсутствия");
  const employee = await env.DB.prepare("SELECT id FROM employees WHERE id = ? AND is_active = 1").bind(employeeId).first();
  if (!employee) return badRequest("Сотрудник не найден");
  const id = newId();
  await env.DB.prepare("INSERT INTO employee_time_off (id, employee_id, starts_at, ends_at, reason) VALUES (?, ?, ?, ?, ?)")
    .bind(id, employeeId, startsAt, endsAt, optionalString(body, "reason", 500)).run();
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action, after_json) VALUES (?, ?, 'employee_time_off', ?, 'CREATE', ?)")
    .bind(newId(), user.id, id, JSON.stringify({ employeeId, startsAt, endsAt })).run();
  return json({ ok: true, id }, 201);
};

export const onRequestDelete: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "schedules.write")) return forbidden();
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return badRequest("Отсутствие не найдено");
  const result = await env.DB.prepare("DELETE FROM employee_time_off WHERE id = ?").bind(id).run();
  if (!result.meta.changes) return notFound("Отсутствие не найдено");
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action) VALUES (?, ?, 'employee_time_off', ?, 'DELETE')").bind(newId(), user.id, id).run();
  return json({ ok: true });
};
