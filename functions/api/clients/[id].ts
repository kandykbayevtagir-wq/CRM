import { auditStatement } from "../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, boundedString, conflict, json, notFound, optionalString, readJson } from "../../_lib/http";
import { isoColumn } from "../../_lib/dates";
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
    const client = await env.DB.prepare(`SELECT c.id, c.full_name AS fullName, c.phone, c.email, c.created_at AS createdAt,
      c.is_active AS isActive, NULL AS notes, NULL AS total,
      COUNT(CASE WHEN a.status = 'COMPLETED' THEN 1 END) AS visits,
      MAX(CASE WHEN a.status = 'COMPLETED' THEN a.starts_at END) AS lastVisit,
      MIN(CASE WHEN julianday(a.starts_at) > julianday('now') AND a.status IN ('SCHEDULED','CONFIRMED') THEN a.starts_at END) AS nextVisit
      FROM clients c LEFT JOIN appointments a ON a.client_id = c.id AND a.employee_id = ? WHERE c.id = ? GROUP BY c.id`).bind(employee.id, id).first();
    const appointments = await env.DB.prepare(`SELECT a.id, ${isoColumn("a.starts_at")} AS startsAt, a.status, a.notes, a.cancel_reason AS cancelReason,
      e.full_name AS employeeName, b.name AS branchName,
      (SELECT group_concat(s.name, ', ') FROM appointment_services aps JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id) AS serviceName
      FROM appointments a JOIN employees e ON e.id = a.employee_id JOIN branches b ON b.id = a.branch_id
      WHERE a.client_id = ? AND a.employee_id = ? ORDER BY julianday(a.starts_at) DESC LIMIT 100`).bind(id, employee.id).all();
    return json({ ok: true, restricted: true, client, appointments: appointments.results ?? [], payments: [], timeline: [] });
  }
  const client = await env.DB.prepare(`
    SELECT c.id, c.full_name AS fullName, c.phone, c.email, c.notes, c.created_at AS createdAt,
      c.updated_at AS updatedAt, c.is_active AS isActive,
      COUNT(CASE WHEN a.status = 'COMPLETED' THEN 1 END) AS visits,
      MAX(CASE WHEN a.status = 'COMPLETED' THEN a.starts_at END) AS lastVisit,
      MIN(CASE WHEN julianday(a.starts_at) >= julianday('now') AND a.status NOT IN ('CANCELLED', 'NO_SHOW', 'COMPLETED') THEN a.starts_at END) AS nextVisit,
      COALESCE((SELECT SUM(p.amount) FROM payments p INNER JOIN appointments pa ON pa.id = p.appointment_id WHERE pa.client_id = c.id AND pa.status = 'COMPLETED' AND p.payment_status = 'POSTED'), 0)
      - COALESCE((SELECT SUM(r.amount) FROM payment_adjustments r INNER JOIN payments rp ON rp.id = r.payment_id INNER JOIN appointments ra ON ra.id = rp.appointment_id WHERE ra.client_id = c.id), 0) AS total
    FROM clients c LEFT JOIN appointments a ON a.client_id = c.id WHERE c.id = ? GROUP BY c.id
  `).bind(id).first();
  if (!client) return notFound("Клиент не найден");

  const [appointments, payments, timeline] = await Promise.all([
    env.DB.prepare(`
      SELECT a.id, ${isoColumn("a.starts_at")} AS startsAt, ${isoColumn("a.ends_at")} AS endsAt, a.status, a.total_amount AS amount,
        a.notes, a.cancel_reason AS cancelReason, a.source, e.full_name AS employeeName, b.name AS branchName,
        (SELECT group_concat(s.name, ', ') FROM appointment_services aps INNER JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id) AS serviceName,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.appointment_id = a.id AND p.payment_status = 'POSTED'), 0) AS paidAmount
      FROM appointments a LEFT JOIN employees e ON e.id = a.employee_id LEFT JOIN branches b ON b.id = a.branch_id
      WHERE a.client_id = ? ORDER BY julianday(a.starts_at) DESC LIMIT 200
    `).bind(id).all(),
    env.DB.prepare(`
      SELECT p.id, p.amount, p.method, p.payment_status AS status, ${isoColumn("p.paid_at")} AS paidAt,
        a.id AS appointmentId, ${isoColumn("a.starts_at")} AS startsAt, (SELECT group_concat(s.name, ', ') FROM appointment_services aps INNER JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id) AS serviceName
      FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id
      WHERE a.client_id = ? ORDER BY julianday(p.paid_at) DESC LIMIT 200
    `).bind(id).all(),
    env.DB.prepare(`
      SELECT 'appointment' AS type, a.id AS entityId, ${isoColumn("a.starts_at")} AS occurredAt, a.status AS action,
        'Запись клиента' AS title, a.notes AS details FROM appointments a WHERE a.client_id = ?
      UNION ALL
      SELECT 'payment', p.id, ${isoColumn("p.paid_at")}, 'PAYMENT', 'Оплата', CAST(p.amount AS TEXT) FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id WHERE a.client_id = ?
      UNION ALL
      SELECT 'status', h.id, ${isoColumn("h.created_at")}, h.to_status, 'Изменение статуса', h.note FROM appointment_status_history h INNER JOIN appointments a ON a.id = h.appointment_id WHERE a.client_id = ?
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
  const fullName = boundedString(body, "fullName", 200, String(existing.full_name ?? ""));
  // The phone is re-validated only when it is actually being changed, so legacy cards
  // with an unusual stored number can still be edited (notes, archive) without touching it.
  const phoneProvided = typeof body.phone === "string";
  const phoneRaw = phoneProvided ? boundedString(body, "phone", 40) : String(existing.phone ?? "");
  const phone = phoneProvided ? requirePhone(phoneValue({ phone: phoneRaw })) : String(existing.phone_normalized ?? "") || requirePhone(phoneValue({ phone: phoneRaw }));
  if (!fullName || !phone) return badRequest("Укажите имя и корректный телефон клиента", phoneProvided ? { phone: "Введите 10 цифр после +7" } : undefined);
  const isActive = body.isActive === undefined ? Number(existing.is_active ?? 1) : body.isActive === false || body.isActive === "false" ? 0 : 1;
  if (isActive === 1) {
    const duplicate = await env.DB.prepare("SELECT id, full_name AS fullName FROM clients WHERE phone_normalized = ? AND id <> ? AND is_active = 1 LIMIT 1")
      .bind(phone, id).first<{ id: string; fullName: string }>();
    if (duplicate) return conflict(`Клиент с таким телефоном уже есть: ${duplicate.fullName}`);
  }
  const after = { fullName, phone: phoneRaw, phoneNormalized: phone, isActive };
  await env.DB.batch([
    env.DB.prepare(`UPDATE clients SET full_name = ?, phone = ?, phone_normalized = ?, email = ?, notes = ?, is_active = ?, archived_at = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(archived_at, CURRENT_TIMESTAMP) END, archived_by = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(archived_by, ?) END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(fullName, phoneRaw, phone, body.email === null ? null : optionalString(body, "email", 200) ?? existing.email ?? null, body.notes === null ? null : optionalString(body, "notes") ?? existing.notes ?? null, isActive, isActive, isActive, user.id, id),
    auditStatement(env.DB, user, "client", id, "UPDATE", { fullName: existing.full_name, phone: existing.phone, isActive: existing.is_active }, after),
    // Archiving a card ends the client's portal access until the card is restored.
    ...(isActive === 0 ? [env.DB.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE client_id = ?)").bind(id)] : []),
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
    env.DB.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE client_id = ?)").bind(id),
    auditStatement(env.DB, user, "client", id, "ARCHIVE", { fullName: existing.fullName, isActive: existing.isActive }, { isActive: 0 }),
  ]);
  return json({ ok: true });
};
