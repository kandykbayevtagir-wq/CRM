import { auditStatement } from "../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, json, newId, optionalString, readJson } from "../_lib/http";
import { branchIds, employeeValues } from "../_lib/employee";

const employeeQuery = `
  SELECT e.id, e.full_name AS fullName, e.position, e.phone, e.email,
    e.branch_id AS branchId,
    COALESCE((SELECT group_concat(b2.name, ', ') FROM employee_branches eb2 INNER JOIN branches b2 ON b2.id = eb2.branch_id WHERE eb2.employee_id = e.id), b.name) AS branchName,
    e.fixed_salary AS fixedSalary, e.revenue_percent AS revenuePercent,
    e.is_active AS isActive, e.user_id AS userId,
    (SELECT COUNT(*) FROM appointments ea WHERE ea.employee_id = e.id AND ea.status NOT IN ('CANCELLED', 'NO_SHOW') AND strftime('%Y-%m', ea.starts_at) = strftime('%Y-%m', 'now', 'localtime')) AS appointments,
    (SELECT COALESCE(SUM(p.amount), 0) FROM payments p INNER JOIN appointments pa ON pa.id = p.appointment_id WHERE pa.employee_id = e.id AND pa.status = 'COMPLETED' AND p.payment_status = 'POSTED' AND strftime('%Y-%m', p.paid_at) = strftime('%Y-%m', 'now', 'localtime'))
      - (SELECT COALESCE(SUM(r.amount), 0) FROM payment_adjustments r INNER JOIN payments rp ON rp.id = r.payment_id INNER JOIN appointments ra ON ra.id = rp.appointment_id WHERE ra.employee_id = e.id AND ra.status = 'COMPLETED' AND strftime('%Y-%m', r.occurred_at) = strftime('%Y-%m', 'now', 'localtime')) AS revenue
  FROM employees e
  LEFT JOIN branches b ON b.id = e.branch_id
  ORDER BY e.is_active DESC, e.full_name ASC
`;

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "employees.read")) return forbidden();
  const result = await env.DB.prepare(employeeQuery).all();
  return json({ ok: true, items: result.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "employees.write")) return forbidden();
  const body = await readJson(request);
  const values = employeeValues(body);
  if (!values.fullName || !values.position || values.fixedSalary < 0 || values.revenuePercent < 0) return badRequest("Проверьте имя, должность и зарплатные настройки");
  const ids = branchIds(body);
  const id = newId();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`INSERT INTO employees (id, full_name, position, phone, email, branch_id, user_id, fixed_salary, revenue_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, values.fullName, values.position, optionalString(body, "phone"), optionalString(body, "email"), ids[0] ?? null, optionalString(body, "userId"), values.fixedSalary, values.revenuePercent),
  ];
  for (const [index, branchId] of ids.entries()) statements.push(env.DB.prepare("INSERT INTO employee_branches (employee_id, branch_id, is_primary) VALUES (?, ?, ?)").bind(id, branchId, index === 0 ? 1 : 0));
  statements.push(auditStatement(env.DB, user, "employee", id, "CREATE", null, { fullName: values.fullName, position: values.position, branchIds: ids }));
  await env.DB.batch(statements);
  return json({ ok: true, id }, 201);
};
