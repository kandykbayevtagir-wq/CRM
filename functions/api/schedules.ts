import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, json, newId, numberValue, readJson, stringValue } from "../_lib/http";

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "schedules.read")) return forbidden();
  const ownEmployee = user.role === "SPECIALIST"
    ? await env.DB.prepare("SELECT id FROM employees WHERE user_id = ? AND is_active = 1 LIMIT 1").bind(user.id).first<{ id: string }>()
    : null;
  if (user.role === "SPECIALIST" && !ownEmployee) return json({ ok: true, employees: [], schedules: [], timeOff: [] });
  const employeeWhere = ownEmployee ? " AND e.id = ?" : "";
  const scheduleWhere = ownEmployee ? " WHERE employee_id = ?" : "";
  const timeOffWhere = ownEmployee ? " AND t.employee_id = ?" : "";
  const employeeBindings = ownEmployee ? [ownEmployee.id] : [];
  const [employees, schedules, timeOff] = await Promise.all([
    env.DB.prepare(`SELECT id, full_name AS fullName, position FROM employees e WHERE e.is_active = 1${employeeWhere} ORDER BY full_name ASC`).bind(...employeeBindings).all(),
    env.DB.prepare(`SELECT id, employee_id AS employeeId, day_of_week AS dayOfWeek, starts_time AS startsTime, ends_time AS endsTime, break_start_time AS breakStartTime, break_end_time AS breakEndTime, is_active AS isActive FROM employee_schedules${scheduleWhere} ORDER BY employee_id, day_of_week`).bind(...employeeBindings).all(),
    env.DB.prepare(`SELECT t.id, t.employee_id AS employeeId, t.starts_at AS startsAt, t.ends_at AS endsAt, t.reason, e.full_name AS employeeName FROM employee_time_off t INNER JOIN employees e ON e.id = t.employee_id WHERE julianday(t.ends_at) >= julianday('now')${timeOffWhere} ORDER BY t.starts_at ASC LIMIT 100`).bind(...employeeBindings).all(),
  ]);
  return json({ ok: true, employees: employees.results ?? [], schedules: schedules.results ?? [], timeOff: timeOff.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "schedules.write")) return forbidden();
  const body = await readJson(request);
  const employeeId = stringValue(body, "employeeId");
  const dayOfWeek = numberValue(body, "dayOfWeek");
  const startsTime = stringValue(body, "startsTime");
  const endsTime = stringValue(body, "endsTime");
  const breakStartTime = stringValue(body, "breakStartTime") || null;
  const breakEndTime = stringValue(body, "breakEndTime") || null;
  const isActive = body.isActive === false || body.isActive === "false" ? 0 : 1;
  if (!employeeId || dayOfWeek < 1 || dayOfWeek > 7 || !timePattern.test(startsTime) || !timePattern.test(endsTime) || startsTime >= endsTime || Boolean(breakStartTime && !timePattern.test(breakStartTime)) || Boolean(breakEndTime && !timePattern.test(breakEndTime))) return badRequest("Проверьте день и рабочий интервал");
  const employee = await env.DB.prepare("SELECT id FROM employees WHERE id = ? AND is_active = 1").bind(employeeId).first();
  if (!employee) return badRequest("Сотрудник не найден");
  const id = newId();
  await env.DB.prepare(`
    INSERT INTO employee_schedules (id, employee_id, day_of_week, starts_time, ends_time, break_start_time, break_end_time, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_id, day_of_week) DO UPDATE SET starts_time = excluded.starts_time, ends_time = excluded.ends_time, break_start_time = excluded.break_start_time, break_end_time = excluded.break_end_time, is_active = excluded.is_active
  `).bind(id, employeeId, dayOfWeek, startsTime, endsTime, breakStartTime, breakEndTime, isActive).run();
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action, after_json) VALUES (?, ?, 'employee_schedule', ?, 'UPSERT', ?)")
    .bind(newId(), user.id, `${employeeId}:${dayOfWeek}`, JSON.stringify({ startsTime, endsTime, isActive })).run();
  return json({ ok: true }, 200);
};

export const onRequestDelete: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "schedules.write")) return forbidden();
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return badRequest("Расписание не найдено");
  await env.DB.prepare("DELETE FROM employee_schedules WHERE id = ?").bind(id).run();
  return json({ ok: true });
};
