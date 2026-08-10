import { getSessionUser, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, dateValue, json, newId, numberValue, optionalString, readJson, stringValue } from "../_lib/http";

const statuses = new Set(["SCHEDULED", "CONFIRMED", "ARRIVED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"]);

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  const search = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const result = search
    ? await env.DB.prepare(`
        SELECT a.id, a.starts_at AS startsAt, a.status, a.total_amount AS amount, a.notes,
          c.full_name AS clientName, c.phone AS clientPhone,
          (SELECT group_concat(s.name, ', ') FROM appointment_services aps INNER JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id) AS serviceName,
          e.full_name AS employeeName, b.name AS branchName
        FROM appointments a
        INNER JOIN clients c ON c.id = a.client_id
        LEFT JOIN employees e ON e.id = a.employee_id
        LEFT JOIN branches b ON b.id = a.branch_id
        WHERE c.full_name LIKE ? OR c.phone LIKE ?
        ORDER BY a.starts_at DESC LIMIT 200
      `).bind(`%${search}%`, `%${search}%`).all()
    : await env.DB.prepare(`
        SELECT a.id, a.starts_at AS startsAt, a.status, a.total_amount AS amount, a.notes,
          c.full_name AS clientName, c.phone AS clientPhone,
          (SELECT group_concat(s.name, ', ') FROM appointment_services aps INNER JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id) AS serviceName,
          e.full_name AS employeeName, b.name AS branchName
        FROM appointments a
        INNER JOIN clients c ON c.id = a.client_id
        LEFT JOIN employees e ON e.id = a.employee_id
        LEFT JOIN branches b ON b.id = a.branch_id
        ORDER BY a.starts_at DESC LIMIT 200
      `).all();
  return json({ ok: true, items: result.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  const body = await readJson(request);
  const startsAt = dateValue(body, "startsAt");
  const clientIdFromBody = stringValue(body, "clientId");
  const clientName = stringValue(body, "clientName");
  const clientPhone = stringValue(body, "clientPhone");
  if (!startsAt || (!clientIdFromBody && (!clientName || !clientPhone))) {
    return badRequest("Дата, клиент и телефон обязательны");
  }

  let clientId = clientIdFromBody;
  const statements: D1PreparedStatement[] = [];
  if (!clientId) {
    const existingClient = await env.DB.prepare("SELECT id FROM clients WHERE phone = ? LIMIT 1").bind(clientPhone).first<{ id: string }>();
    clientId = existingClient?.id ?? newId();
    if (!existingClient) {
      statements.push(env.DB.prepare("INSERT INTO clients (id, full_name, phone) VALUES (?, ?, ?)").bind(clientId, clientName, clientPhone));
    }
  }

  const id = newId();
  const statusValue = stringValue(body, "status", "SCHEDULED").toUpperCase();
  const status = statuses.has(statusValue) ? statusValue : "SCHEDULED";
  const employeeId = optionalString(body, "employeeId");
  const branchId = optionalString(body, "branchId");
  const totalAmount = numberValue(body, "totalAmount");
  statements.push(env.DB.prepare(`
    INSERT INTO appointments (id, client_id, employee_id, branch_id, starts_at, status, total_amount, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, clientId, employeeId, branchId, startsAt, status, totalAmount, optionalString(body, "notes")));

  const serviceName = stringValue(body, "serviceName");
  if (serviceName) {
    const service = await env.DB.prepare("SELECT id FROM services WHERE name = ? LIMIT 1").bind(serviceName).first<{ id: string }>();
    const serviceId = service?.id ?? newId();
    if (!service) {
      statements.push(env.DB.prepare("INSERT INTO services (id, name, price) VALUES (?, ?, ?)").bind(serviceId, serviceName, totalAmount));
    }
    statements.push(env.DB.prepare("INSERT INTO appointment_services (appointment_id, service_id, price) VALUES (?, ?, ?)").bind(id, serviceId, totalAmount));
  }

  statements.push(env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action, after_json) VALUES (?, ?, 'appointment', ?, 'CREATE', ?)")
    .bind(newId(), user.id, id, JSON.stringify({ clientId, startsAt, status, totalAmount })));
  await env.DB.batch(statements);
  return json({ ok: true, id }, 201);
};
