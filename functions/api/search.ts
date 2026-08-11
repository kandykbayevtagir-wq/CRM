import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { json } from "../_lib/http";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "search.read")) return forbidden();
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return json({ ok: true, query, results: [] });
  const like = `%${query}%`;
  const [clients, appointments, employees, services] = await Promise.all([
    env.DB.prepare("SELECT id, full_name AS title, phone AS subtitle FROM clients WHERE is_active = 1 AND (full_name LIKE ? OR phone LIKE ? OR phone_normalized LIKE ?) ORDER BY full_name LIMIT 8").bind(like, like, like).all(),
    env.DB.prepare("SELECT a.id, c.full_name AS title, a.starts_at AS subtitle, a.status FROM appointments a INNER JOIN clients c ON c.id = a.client_id WHERE c.full_name LIKE ? OR c.phone LIKE ? OR a.id LIKE ? ORDER BY a.starts_at DESC LIMIT 8").bind(like, like, like).all(),
    env.DB.prepare("SELECT id, full_name AS title, position AS subtitle FROM employees WHERE is_active = 1 AND (full_name LIKE ? OR position LIKE ?) ORDER BY full_name LIMIT 8").bind(like, like).all(),
    env.DB.prepare("SELECT id, name AS title, category AS subtitle FROM services WHERE is_active = 1 AND (name LIKE ? OR category LIKE ?) ORDER BY name LIMIT 8").bind(like, like).all(),
  ]);
  return json({ ok: true, query, results: [
    ...(clients.results ?? []).map((row) => ({ ...row, type: "client", href: `/clients/${row.id}` })),
    ...(appointments.results ?? []).map((row) => ({ ...row, type: "appointment", href: `/appointments?focus=${row.id}` })),
    ...(employees.results ?? []).map((row) => ({ ...row, type: "employee", href: `/employees/${row.id}` })),
    ...(services.results ?? []).map((row) => ({ ...row, type: "service", href: `/services?focus=${row.id}` })),
  ] });
};
