import { getSessionUser, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, json, newId, optionalString, readJson, stringValue } from "../_lib/http";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const where = query ? "WHERE c.full_name LIKE ? OR c.phone LIKE ?" : "";
  const bindings = query ? [`%${query}%`, `%${query}%`] : [];
  const [result, count] = await Promise.all([
    env.DB.prepare(`
      SELECT c.id, c.full_name AS fullName, c.phone, c.email, c.notes,
        c.created_at AS createdAt, c.updated_at AS updatedAt,
        COUNT(a.id) AS visits, MAX(a.starts_at) AS lastVisit,
        COALESCE(SUM(CASE WHEN a.status = 'COMPLETED' THEN a.total_amount ELSE 0 END), 0) AS total,
        CASE WHEN COUNT(a.id) = 0 THEN 'new' WHEN MAX(a.starts_at) >= datetime('now', 'localtime', '-90 days') THEN 'active' ELSE 'inactive' END AS status
      FROM clients c LEFT JOIN appointments a ON a.client_id = c.id
      ${where}
      GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 100
    `).bind(...bindings).all(),
    env.DB.prepare(`SELECT COUNT(*) AS value FROM clients c ${where}`).bind(...bindings).first<{ value: number }>(),
  ]);
  return json({ ok: true, items: result.results ?? [], total: count?.value ?? 0 });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  const body = await readJson(request);
  const fullName = stringValue(body, "fullName");
  const phone = stringValue(body, "phone");
  if (!fullName || !phone) return badRequest("Имя и телефон клиента обязательны");
  const id = newId();
  await env.DB.prepare("INSERT INTO clients (id, full_name, phone, email, notes) VALUES (?, ?, ?, ?, ?)")
    .bind(id, fullName, phone, optionalString(body, "email"), optionalString(body, "notes")).run();
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action, after_json) VALUES (?, ?, 'client', ?, 'CREATE', ?)")
    .bind(newId(), user.id, id, JSON.stringify({ fullName, phone })).run();
  return json({ ok: true, id }, 201);
};
