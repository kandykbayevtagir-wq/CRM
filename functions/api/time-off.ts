import { forbidden, getSessionUser, isStaff, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, dateValue, json, newId, optionalString, readJson, stringValue } from "../_lib/http";

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isStaff(user)) return forbidden();
  const body = await readJson(request);
  const employeeId = stringValue(body, "employeeId");
  const startsAt = dateValue(body, "startsAt");
  const endsAt = dateValue(body, "endsAt");
  if (!employeeId || !startsAt || !endsAt || new Date(endsAt).getTime() <= new Date(startsAt).getTime()) return badRequest("Укажите корректный период отсутствия");
  const employee = await env.DB.prepare("SELECT id FROM employees WHERE id = ? AND is_active = 1").bind(employeeId).first();
  if (!employee) return badRequest("Сотрудник не найден");
  const id = newId();
  await env.DB.prepare("INSERT INTO employee_time_off (id, employee_id, starts_at, ends_at, reason) VALUES (?, ?, ?, ?, ?)")
    .bind(id, employeeId, startsAt, endsAt, optionalString(body, "reason")).run();
  return json({ ok: true, id }, 201);
};

export const onRequestDelete: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isStaff(user)) return forbidden();
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return badRequest("Отсутствие не найдено");
  await env.DB.prepare("DELETE FROM employee_time_off WHERE id = ?").bind(id).run();
  return json({ ok: true });
};
