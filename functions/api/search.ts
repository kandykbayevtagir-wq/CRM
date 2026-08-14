import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { json } from "../_lib/http";
import { getOwnEmployeeId } from "../_lib/access";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "search.read")) return forbidden();
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return json({ ok: true, query, results: [] });
  const like = `%${query}%`;
  const ownEmployeeId = await getOwnEmployeeId(env.DB, user);
  if (user.role === "SPECIALIST" && !ownEmployeeId) return json({ ok: true, query, results: [] });
  const clientScope = user.role === "SPECIALIST" ? " AND EXISTS (SELECT 1 FROM appointments scoped_client_a WHERE scoped_client_a.client_id = clients.id AND scoped_client_a.employee_id = ?)" : "";
  const appointmentScope = user.role === "SPECIALIST" ? " AND a.employee_id = ?" : "";
  const employeeScope = user.role === "SPECIALIST" ? " AND employees.id = ?" : "";
  const serviceScope = user.role === "SPECIALIST" ? " AND EXISTS (SELECT 1 FROM employee_services scoped_es WHERE scoped_es.service_id = services.id AND scoped_es.employee_id = ? AND scoped_es.active = 1)" : "";
  const [clients, appointments, employees, services] = await Promise.all([
    env.DB.prepare(`SELECT clients.id, clients.full_name AS title, clients.phone AS subtitle FROM clients WHERE clients.is_active = 1 AND (clients.full_name LIKE ? OR clients.phone LIKE ? OR clients.phone_normalized LIKE ?)${clientScope} ORDER BY clients.full_name LIMIT 8`).bind(...(user.role === "SPECIALIST" ? [like, like, like, ownEmployeeId] : [like, like, like])).all(),
    env.DB.prepare(`SELECT a.id, c.full_name AS title, a.starts_at AS subtitle, a.status FROM appointments a INNER JOIN clients c ON c.id = a.client_id WHERE (c.full_name LIKE ? OR c.phone LIKE ? OR a.id LIKE ?)${appointmentScope} ORDER BY a.starts_at DESC LIMIT 8`).bind(...(user.role === "SPECIALIST" ? [like, like, like, ownEmployeeId] : [like, like, like])).all(),
    env.DB.prepare(`SELECT employees.id, employees.full_name AS title, employees.position AS subtitle FROM employees WHERE employees.is_active = 1 AND (employees.full_name LIKE ? OR employees.position LIKE ?)${employeeScope} ORDER BY employees.full_name LIMIT 8`).bind(...(user.role === "SPECIALIST" ? [like, like, ownEmployeeId] : [like, like])).all(),
    env.DB.prepare(`SELECT services.id, services.name AS title, services.category AS subtitle FROM services WHERE services.is_active = 1 AND (services.name LIKE ? OR services.category LIKE ?)${serviceScope} ORDER BY services.name LIMIT 8`).bind(...(user.role === "SPECIALIST" ? [like, like, ownEmployeeId] : [like, like])).all(),
  ]);
  return json({ ok: true, query, results: [
    ...(clients.results ?? []).map((row) => ({ ...row, type: "client", href: `/clients/${row.id}` })),
    ...(appointments.results ?? []).map((row) => ({ ...row, type: "appointment", href: `/appointments?focus=${row.id}` })),
    ...(employees.results ?? []).map((row) => ({ ...row, type: "employee", href: `/employees/${row.id}` })),
    ...(services.results ?? []).map((row) => ({ ...row, type: "service", href: `/services?focus=${row.id}` })),
  ] });
};
