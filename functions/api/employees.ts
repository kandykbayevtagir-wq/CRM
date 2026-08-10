import { forbidden, getSessionUser, isStaff, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, json, newId, optionalString, numberValue, readJson, stringValue } from "../_lib/http";

const employeeQuery = `
  SELECT e.id, e.full_name AS fullName, e.position, e.phone, e.email,
    e.branch_id AS branchId, b.name AS branchName,
    e.fixed_salary AS fixedSalary, e.revenue_percent AS revenuePercent,
    e.is_active AS isActive,
    COUNT(a.id) AS appointments,
    COALESCE(SUM(CASE WHEN a.status = 'COMPLETED' THEN a.total_amount ELSE 0 END), 0) AS revenue
  FROM employees e
  LEFT JOIN branches b ON b.id = e.branch_id
  LEFT JOIN appointments a ON a.employee_id = e.id AND strftime('%Y-%m', a.starts_at) = strftime('%Y-%m', 'now', 'localtime')
  GROUP BY e.id
  ORDER BY e.is_active DESC, e.full_name ASC
`;

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isStaff(user)) return forbidden();
  const result = await env.DB.prepare(employeeQuery).all();
  return json({ ok: true, items: result.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isStaff(user)) return forbidden();
  const body = await readJson(request);
  const fullName = stringValue(body, "fullName");
  const position = stringValue(body, "position");
  if (!fullName || !position) return badRequest("Имя и должность сотрудника обязательны");
  const id = newId();
  await env.DB.prepare(`
    INSERT INTO employees (id, full_name, position, phone, email, branch_id, fixed_salary, revenue_percent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    fullName,
    position,
    optionalString(body, "phone"),
    optionalString(body, "email"),
    optionalString(body, "branchId"),
    numberValue(body, "fixedSalary"),
    numberValue(body, "revenuePercent"),
  ).run();
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action, after_json) VALUES (?, ?, 'employee', ?, 'CREATE', ?)")
    .bind(newId(), user.id, id, JSON.stringify({ fullName, position })).run();
  return json({ ok: true, id }, 201);
};
