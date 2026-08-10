import { auditStatement } from "../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, conflict, json, newId, optionalString, readJson, stringValue } from "../_lib/http";
import { phoneValue, requirePhone } from "../_lib/validation";

function queryParts(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  const status = params.get("status") ?? "active";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(10, Number(params.get("pageSize") ?? "25") || 25));
  const filters: string[] = [];
  const bindings: Array<string | number> = [];

  if (status === "archived") {
    filters.push("c.is_active = 0");
  } else if (status !== "all") {
    filters.push("c.is_active = 1");
  }
  if (query) {
    filters.push("(c.full_name LIKE ? OR c.phone LIKE ? OR c.phone_normalized LIKE ?)");
    bindings.push(`%${query}%`, `%${query}%`, `%${phoneValue({ phone: query })}%`);
  }

  return { filters, bindings, page, pageSize, offset: (page - 1) * pageSize, query, status };
}

const clientSelect = `
  SELECT c.id, c.full_name AS fullName, c.phone, c.email, c.notes,
    c.created_at AS createdAt, c.updated_at AS updatedAt, c.is_active AS isActive,
    COUNT(CASE WHEN a.status = 'COMPLETED' THEN 1 END) AS visits,
    MAX(CASE WHEN a.status = 'COMPLETED' THEN a.starts_at END) AS lastVisit,
    MIN(CASE WHEN a.starts_at >= CURRENT_TIMESTAMP AND a.status NOT IN ('CANCELLED', 'NO_SHOW', 'COMPLETED') THEN a.starts_at END) AS nextVisit,
    COALESCE((
      SELECT SUM(p.amount) FROM payments p
      INNER JOIN appointments paid_a ON paid_a.id = p.appointment_id
      WHERE paid_a.client_id = c.id AND paid_a.status = 'COMPLETED' AND p.payment_status = 'POSTED'
    ), 0) - COALESCE((
      SELECT SUM(pa.amount) FROM payment_adjustments pa
      INNER JOIN payments refunded_p ON refunded_p.id = pa.payment_id
      INNER JOIN appointments refunded_a ON refunded_a.id = refunded_p.appointment_id
      WHERE refunded_a.client_id = c.id AND refunded_a.status = 'COMPLETED'
    ), 0) AS total,
    CASE WHEN c.is_active = 0 THEN 'archived'
      WHEN COUNT(CASE WHEN a.status = 'COMPLETED' THEN 1 END) = 0 THEN 'new'
      WHEN MAX(CASE WHEN a.status = 'COMPLETED' THEN a.starts_at END) >= datetime('now', 'localtime', '-90 days') THEN 'active'
      ELSE 'inactive' END AS status
  FROM clients c
  LEFT JOIN appointments a ON a.client_id = c.id
`;

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "clients.read")) return forbidden();
  const { filters, bindings, page, pageSize, offset, query, status } = queryParts(request);
  if (user.role === "SPECIALIST") {
    const employee = await env.DB.prepare("SELECT id FROM employees WHERE user_id = ? AND is_active = 1 LIMIT 1").bind(user.id).first<{ id: string }>();
    if (!employee) return json({ ok: true, items: [], total: 0, page, pageSize, pages: 0, query, status });
    filters.push("EXISTS (SELECT 1 FROM appointments scoped_a WHERE scoped_a.client_id = c.id AND scoped_a.employee_id = ?)");
    bindings.push(employee.id);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const [result, count] = await Promise.all([
    env.DB.prepare(`${clientSelect} ${where} GROUP BY c.id ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`)
      .bind(...bindings, pageSize, offset).all(),
    env.DB.prepare(`SELECT COUNT(*) AS value FROM clients c ${where}`).bind(...bindings).first<{ value: number }>(),
  ]);
  const total = Number(count?.value ?? 0);
  return json({ ok: true, items: result.results ?? [], total, page, pageSize, pages: Math.ceil(total / pageSize), query, status });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "clients.write")) return forbidden();
  const body = await readJson(request);
  const fullName = stringValue(body, "fullName");
  const phoneRaw = stringValue(body, "phone");
  const phone = requirePhone(phoneValue(body));
  if (!fullName || fullName.length < 2 || !phone) return badRequest("Укажите имя и корректный телефон клиента");
  const duplicate = await env.DB.prepare("SELECT id, full_name AS fullName FROM clients WHERE phone_normalized = ? AND is_active = 1 LIMIT 1")
    .bind(phone)
    .first<{ id: string; fullName: string }>();
  if (duplicate) return conflict(`Клиент с таким телефоном уже есть: ${duplicate.fullName}`);

  const id = newId();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO clients (id, full_name, phone, phone_normalized, email, notes, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)")
      .bind(id, fullName, phoneRaw, phone, optionalString(body, "email"), optionalString(body, "notes")),
    auditStatement(env.DB, user, "client", id, "CREATE", null, { fullName, phone: phoneRaw, phoneNormalized: phone }),
  ]);
  return json({ ok: true, id }, 201);
};
