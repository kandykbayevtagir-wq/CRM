import { forbidden, getSessionUser, isStaff, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, dateValue, json, newId, numberValue, optionalString, readJson, stringValue } from "../_lib/http";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isStaff(user)) return forbidden();
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const result = query
    ? await env.DB.prepare(`
        SELECT x.id, x.title, x.category, x.branch_id AS branchId, b.name AS branchName,
          x.amount, x.occurred_at AS occurredAt, x.status, x.description
        FROM expenses x LEFT JOIN branches b ON b.id = x.branch_id
        WHERE x.title LIKE ? OR x.category LIKE ?
        ORDER BY x.occurred_at DESC LIMIT 200
      `).bind(`%${query}%`, `%${query}%`).all()
    : await env.DB.prepare(`
        SELECT x.id, x.title, x.category, x.branch_id AS branchId, b.name AS branchName,
          x.amount, x.occurred_at AS occurredAt, x.status, x.description
        FROM expenses x LEFT JOIN branches b ON b.id = x.branch_id
        ORDER BY x.occurred_at DESC LIMIT 200
      `).all();
  return json({ ok: true, items: result.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isStaff(user)) return forbidden();
  const body = await readJson(request);
  const title = stringValue(body, "title");
  const category = stringValue(body, "category");
  const occurredAt = dateValue(body, "occurredAt") || new Date().toISOString();
  if (!title || !category) return badRequest("Название и категория расхода обязательны");
  const id = newId();
  const status = stringValue(body, "status", "PAID").toUpperCase() === "PLANNED" ? "PLANNED" : "PAID";
  await env.DB.prepare(`
    INSERT INTO expenses (id, title, category, branch_id, amount, occurred_at, status, description, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, title, category, optionalString(body, "branchId"), numberValue(body, "amount"), occurredAt, status, optionalString(body, "description"), user.id).run();
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action, after_json) VALUES (?, ?, 'expense', ?, 'CREATE', ?)")
    .bind(newId(), user.id, id, JSON.stringify({ title, category, amount: numberValue(body, "amount") })).run();
  return json({ ok: true, id }, 201);
};
