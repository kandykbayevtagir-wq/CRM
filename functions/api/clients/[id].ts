import { auditStatement } from "../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, conflict, json, notFound, optionalString, readJson, stringValue } from "../../_lib/http";
import { phoneValue, requirePhone } from "../../_lib/validation";

function routeId(params: Record<string, string | string[] | undefined>): string {
  const value = params.id;
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "clients.read")) return forbidden();
  const id = routeId(params);
  if (!id) return notFound("Клиент не найден");
  if (user.role === "SPECIALIST") {
    const employee = await env.DB.prepare("SELECT id FROM employees WHERE user_id = ? AND is_active = 1 LIMIT 1").bind(user.id).first<{ id: string }>();
    if (!employee) return forbidden();
    const allowed = await env.DB.prepare("SELECT id FROM appointments WHERE client_id = ? AND employee_id = ? LIMIT 1").bind(id, employee.id).first();
    if (!allowed) return forbidden();
  }
  const client = await env.DB.prepare(`
    SELECT c.id, c.full_name AS fullName, c.phone, c.email, c.notes, c.created_at AS createdAt,
      c.updated_at AS updatedAt, c.is_active AS isActive,
      COUNT(CASE WHEN a.status = 'COMPLETED' THEN 1 END) AS visits,
      MAX(CASE WHEN a.status = 'COMPLETED' THEN a.starts_at END) AS lastVisit,
      MIN(CASE WHEN a.starts_at >= CURRENT_TIMESTAMP AND a.status NOT IN ('CANCELLED', 'NO_SHOW', 'COMPLETED') THEN a.starts_at END) AS nextVisit,
      COALESCE((SELECT SUM(p.amount) FROM payments p INNER JOIN appointments pa ON pa.id = p.appointment_id WHERE pa.client_id = c.id AND pa.status = 'COMPLETED' AND p.payment_status = 'POSTED'), 0)
      - COALESCE((SELECT SUM(r.amount) FROM payment_adjustments r INNER JOIN payments rp ON rp.id = r.payment_id INNER JOIN appointments ra ON ra.id = rp.appointment_id WHERE ra.client_id = c.id), 0) AS total
    FROM clients c LEFT JOIN appointments a ON a.client_id = c.id WHERE c.id = ? GROUP BY c.id
  `).bind(id).first();
  if (!client) return notFound("Клиент не найден");

  const [appointments, payments, timeline] = await Promise.all([
    env.DB.prepare(`
      SELECT a.id, a.starts_at AS startsAt, a.ends_at AS endsAt, a.status, a.total_amount AS amount,
        a.notes, a.cancel_reason AS cancelReason, a.source, e.full_name AS employeeName, b.name AS branchName,
        (SELECT group_concat(s.name, ', ') FROM appointment_services aps INNER JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id) AS serviceName,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.appointment_id = a.id AND p.payment_status = 'POSTED'), 0) AS paidAmount
      FROM appointments a LEFT JOIN employees e ON e.id = a.employee_id LEFT JOIN branches b ON b.id = a.branch_id
      WHERE a.client_id = ? ORDER BY a.starts_at DESC LIMIT 200
    `).bind(id).all(),
    env.DB.prepare(`
      SELECT p.id, p.amount, p.method, p.payment_status AS status, p.paid_at AS paidAt,
        a.id AS appointmentId, a.starts_at AS startsAt, (SELECT group_concat(s.name, ', ') FROM appointment_services aps INNER JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id) AS serviceName
      FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id
      WHERE a.client_id = ? ORDER BY p.paid_at DESC LIMIT 200
    `).bind(id).all(),
    env.DB.prepare(`
      SELECT 'appointment' AS type, a.id AS entityId, a.starts_at AS occurredAt, a.status AS action,
        'Запись клиента' AS title, a.notes AS details FROM appointments a WHERE a.client_id = ?
      UNION ALL
      SELECT 'payment', p.id, p.paid_at, 'PAYMENT', 'Оплата', CAST(p.amount AS TEXT) FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id WHERE a.client_id = ?
      UNION ALL
      SELECT 'status', h.id, h.created_at, h.to_status, 'Изменение статуса', h.note FROM appointment_status_history h INNER JOIN appointments a ON a.id = h.appointment_id WHERE a.client_id = ?
      ORDER BY occurredAt DESC LIMIT 300
    `).bind(id, id, id).all(),
  ]);
  return json({ ok: true, client, appointments: appointments.results ?? [], payments: payments.results ?? [], timeline: timeline.results ?? [] });
};

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "clients.write")) return forbidden();
  const id = routeId(params);
  const existing = await env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!existing) return notFound("Клиент не найден");
  const body = await readJson(request);
  const fullName = stringValue(body, "fullName", String(existing.full_name ?? ""));
  const phoneRaw = stringValue(body, "phone", String(existing.phone ?? ""));
  const phone = requirePhone(phoneValue({ phone: phoneRaw }));
  if (!fullName || !phone) return badRequest("Укажите имя и корректный телефон клиента");
  const duplicate = await env.DB.prepare("SELECT id, full_name AS fullName FROM clients WHERE phone_normalized = ? AND id <> ? AND is_active = 1 LIMIT 1")
    .bind(phone, id).first<{ id: string; fullName: string }>();
  if (duplicate) return conflict(`Клиент с таким телефоном уже есть: ${duplicate.fullName}`);
  const isActive = body.isActive === undefined ? Number(existing.is_active ?? 1) : body.isActive === false || body.isActive === "false" ? 0 : 1;
  const after = { fullName, phone: phoneRaw, phoneNormalized: phone, isActive };
  await env.DB.batch([
    env.DB.prepare(`UPDATE clients SET full_name = ?, phone = ?, phone_normalized = ?, email = ?, notes = ?, is_active = ?, archived_at = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(archived_at, CURRENT_TIMESTAMP) END, archived_by = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(archived_by, ?) END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(fullName, phoneRaw, phone, body.email === null ? null : optionalString(body, "email") ?? existing.email ?? null, body.notes === null ? null : optionalString(body, "notes") ?? existing.notes ?? null, isActive, isActive, isActive, user.id, id),
    auditStatement(env.DB, user, "client", id, "UPDATE", { fullName: existing.full_name, phone: existing.phone, isActive: existing.is_active }, after),
  ]);
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "clients.archive")) return forbidden();
  const id = routeId(params);
  const existing = await env.DB.prepare("SELECT id, full_name AS fullName, is_active AS isActive FROM clients WHERE id = ?").bind(id).first<{ id: string; fullName: string; isActive: number }>();
  if (!existing) return notFound("Клиент не найден");
  await env.DB.batch([
    env.DB.prepare("UPDATE clients SET is_active = 0, archived_at = CURRENT_TIMESTAMP, archived_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(user.id, id),
    auditStatement(env.DB, user, "client", id, "ARCHIVE", { fullName: existing.fullName, isActive: existing.isActive }, { isActive: 0 }),
  ]);
  return json({ ok: true });
};
