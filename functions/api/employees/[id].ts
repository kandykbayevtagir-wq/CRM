import { auditStatement } from "../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, json, notFound, optionalString, readJson } from "../../_lib/http";
import { branchIds, employeeValues } from "../../_lib/employee";
import { optionalPhoneValue } from "../../_lib/validation";

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "employees.write")) return forbidden();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const existing = await env.DB.prepare("SELECT * FROM employees WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!existing) return notFound("Сотрудник не найден");
  const body = await readJson(request);
  const values = employeeValues(body, existing);
  const phone = optionalPhoneValue(body);
  if (!values.fullName || !values.position || values.fixedSalary < 0 || values.revenuePercent < 0) return badRequest("Проверьте имя, должность и зарплатные настройки");
  if (phone.provided && !phone.value) return badRequest("Проверьте данные", { phone: "Введите 10 цифр после +7" });
  const ids = branchIds(body);
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`UPDATE employees SET full_name = ?, position = ?, phone = ?, email = ?, branch_id = ?, user_id = ?, fixed_salary = ?, revenue_percent = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(values.fullName, values.position, phone.provided ? phone.value : existing.phone ?? null, optionalString(body, "email") ?? existing.email ?? null, ids[0] ?? existing.branch_id ?? null, optionalString(body, "userId") ?? existing.user_id ?? null, values.fixedSalary, values.revenuePercent, body.isActive === undefined ? Number(existing.is_active ?? 1) : body.isActive === false || body.isActive === "false" ? 0 : 1, id),
    env.DB.prepare("DELETE FROM employee_branches WHERE employee_id = ?").bind(id),
  ];
  for (const [index, branchId] of ids.entries()) statements.push(env.DB.prepare("INSERT INTO employee_branches (employee_id, branch_id, is_primary) VALUES (?, ?, ?)").bind(id, branchId, index === 0 ? 1 : 0));
  statements.push(auditStatement(env.DB, user, "employee", id, "UPDATE", { fullName: existing.full_name, position: existing.position }, { fullName: values.fullName, position: values.position, branchIds: ids }));
  await env.DB.batch(statements);
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "employees.write")) return forbidden();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const result = await env.DB.prepare("UPDATE employees SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
  if (!result.success || result.meta.changes === 0) return notFound("Сотрудник не найден");
  await env.DB.batch([auditStatement(env.DB, user, "employee", id, "ARCHIVE", { isActive: 1 }, { isActive: 0 })]);
  return json({ ok: true });
};
