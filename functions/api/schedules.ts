import { forbidden, getSessionUser, isStaff, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, json, newId, numberValue, readJson, stringValue } from "../_lib/http";

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isStaff(user)) return forbidden();
  const [employees, schedules, timeOff] = await Promise.all([
    env.DB.prepare("SELECT id, full_name AS fullName, position FROM employees WHERE is_active = 1 ORDER BY full_name ASC").all(),
    env.DB.prepare("SELECT id, employee_id AS employeeId, day_of_week AS dayOfWeek, starts_time AS startsTime, ends_time AS endsTime, is_active AS isActive FROM employee_schedules ORDER BY employee_id, day_of_week").all(),
    env.DB.prepare("SELECT t.id, t.employee_id AS employeeId, t.starts_at AS startsAt, t.ends_at AS endsAt, t.reason, e.full_name AS employeeName FROM employee_time_off t INNER JOIN employees e ON e.id = t.employee_id WHERE julianday(t.ends_at) >= julianday('now') ORDER BY t.starts_at ASC LIMIT 100").all(),
  ]);
  return json({ ok: true, employees: employees.results ?? [], schedules: schedules.results ?? [], timeOff: timeOff.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isStaff(user)) return forbidden();
  const body = await readJson(request);
  const employeeId = stringValue(body, "employeeId");
  const dayOfWeek = numberValue(body, "dayOfWeek");
  const startsTime = stringValue(body, "startsTime");
  const endsTime = stringValue(body, "endsTime");
  const isActive = body.isActive === false || body.isActive === "false" ? 0 : 1;
  if (!employeeId || dayOfWeek < 1 || dayOfWeek > 7 || !timePattern.test(startsTime) || !timePattern.test(endsTime) || startsTime >= endsTime) return badRequest("Проверьте день и рабочий интервал");
  const employee = await env.DB.prepare("SELECT id FROM employees WHERE id = ? AND is_active = 1").bind(employeeId).first();
  if (!employee) return badRequest("Сотрудник не найден");
  const id = newId();
  await env.DB.prepare(`
    INSERT INTO employee_schedules (id, employee_id, day_of_week, starts_time, ends_time, is_active)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_id, day_of_week) DO UPDATE SET starts_time = excluded.starts_time, ends_time = excluded.ends_time, is_active = excluded.is_active
  `).bind(id, employeeId, dayOfWeek, startsTime, endsTime, isActive).run();
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action, after_json) VALUES (?, ?, 'employee_schedule', ?, 'UPSERT', ?)")
    .bind(newId(), user.id, `${employeeId}:${dayOfWeek}`, JSON.stringify({ startsTime, endsTime, isActive })).run();
  return json({ ok: true }, 200);
};

export const onRequestDelete: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isStaff(user)) return forbidden();
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return badRequest("Расписание не найдено");
  await env.DB.prepare("DELETE FROM employee_schedules WHERE id = ?").bind(id).run();
  return json({ ok: true });
};
