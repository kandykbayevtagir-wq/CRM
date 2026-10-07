import Decimal from "decimal.js";
import { scheduleConflict } from "../_lib/schedule";

import { auditStatement } from "../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, boundedString, conflict, escapeLike, json, LIKE_ESCAPE, newCheckInToken, newId, optionalString, readJson, stringValue } from "../_lib/http";
import { isoColumn, isValidCalendarDate, normalizeIso, organizationTimezone, zonedDateValue } from "../_lib/dates";
import { isAppointmentStatus } from "../../src/lib/appointments/transitions";
import { reservationStatements } from "../_lib/booking";
import { normalizePhone } from "../../src/lib/validation/phone";
import { requirePhone } from "../_lib/validation";
import { localDayRange } from "../../src/lib/appointments/schedule";

const sources = new Set(["ADMIN", "TELEGRAM", "PHONE", "WEBSITE", "REFERRAL", "OTHER"]);

function serviceIdsFromBody(body: Record<string, unknown>): string[] {
  const raw = body.serviceIds ?? body.serviceId;
  if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim());
  if (typeof raw === "string") return raw.split(",").map((value) => value.trim()).filter(Boolean);
  return [];
}

/** Date-only bounds are organisation-local calendar days (the `to` day inclusive); instants are used as-is. */
function dateRange(request: Request, timezone: string) {
  const params = new URL(request.url).searchParams;
  const date = params.get("date")?.trim() ?? "";
  const fromRaw = params.get("from")?.trim() || date;
  const toRaw = params.get("to")?.trim() || date;
  const from = fromRaw ? (isValidCalendarDate(fromRaw) ? localDayRange(fromRaw, timezone).from : normalizeIso(fromRaw)) : "";
  const to = toRaw ? (isValidCalendarDate(toRaw) ? localDayRange(toRaw, timezone).to : normalizeIso(toRaw)) : "";
  return { from, to };
}

const appointmentSelect = `
  SELECT a.id, a.revision, ${isoColumn("a.starts_at")} AS startsAt, ${isoColumn("a.ends_at")} AS endsAt, a.status, a.total_amount AS amount,
    a.notes, a.cancel_reason AS cancelReason, a.source,
    a.client_id AS clientId, a.employee_id AS employeeId, a.branch_id AS branchId,
    c.full_name AS clientName, c.phone AS clientPhone,
    (SELECT group_concat(s.name, ', ') FROM appointment_services aps INNER JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id) AS serviceName,
    e.full_name AS employeeName, b.name AS branchName,
    COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.appointment_id = a.id AND p.payment_status = 'POSTED'), 0)
      - COALESCE((SELECT SUM(pa.amount) FROM payment_adjustments pa INNER JOIN payments rp ON rp.id = pa.payment_id WHERE rp.appointment_id = a.id), 0) AS paidAmount,
    CASE WHEN a.total_amount - (COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.appointment_id = a.id AND p.payment_status = 'POSTED'), 0) - COALESCE((SELECT SUM(pa.amount) FROM payment_adjustments pa INNER JOIN payments rp ON rp.id = pa.payment_id WHERE rp.appointment_id = a.id), 0)) < 0 THEN 0 ELSE a.total_amount - (COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.appointment_id = a.id AND p.payment_status = 'POSTED'), 0) - COALESCE((SELECT SUM(pa.amount) FROM payment_adjustments pa INNER JOIN payments rp ON rp.id = pa.payment_id WHERE rp.appointment_id = a.id), 0)) END AS balance
  FROM appointments a
  INNER JOIN clients c ON c.id = a.client_id
  LEFT JOIN employees e ON e.id = a.employee_id
  LEFT JOIN branches b ON b.id = a.branch_id
`;

async function ownEmployeeId(env: CrmEnv, userId: string, role: string): Promise<string | null> {
  if (role !== "SPECIALIST") return null;
  const employee = await env.DB.prepare("SELECT id FROM employees WHERE user_id = ? AND is_active = 1 LIMIT 1").bind(userId).first<{ id: string }>();
  return employee?.id ?? null;
}

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "appointments.read")) return forbidden();
  const params = new URL(request.url).searchParams;
  const timezone = await organizationTimezone(env.DB);
  const { from, to } = dateRange(request, timezone);
  const query = (params.get("q")?.trim() ?? "").slice(0, 100);
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const pageSize = Math.min(200, Math.max(10, Number(params.get("pageSize") ?? "50") || 50));
  const filters: string[] = [];
  const bindings: Array<string | number> = [];
  const ownId = await ownEmployeeId(env, user.id, user.role);
  if (user.role === "SPECIALIST" && !ownId) return json({ ok: true, items: [], total: 0, page, pageSize, pages: 0 });
  if (ownId) { filters.push("a.employee_id = ?"); bindings.push(ownId); }
  if (from) { filters.push("julianday(a.starts_at) >= julianday(?)"); bindings.push(from); }
  if (to) { filters.push("julianday(a.starts_at) < julianday(?)"); bindings.push(to); }
  const branchId = params.get("branchId")?.trim();
  const employeeId = params.get("employeeId")?.trim();
  const status = params.get("status")?.trim().toUpperCase();
  if (branchId) { filters.push("a.branch_id = ?"); bindings.push(branchId); }
  if (employeeId && !ownId) { filters.push("a.employee_id = ?"); bindings.push(employeeId); }
  if (status && isAppointmentStatus(status)) { filters.push("a.status = ?"); bindings.push(status); }
  if (query) { filters.push(`(c.full_name LIKE ? ${LIKE_ESCAPE} OR c.phone LIKE ? ${LIKE_ESCAPE} OR c.phone_normalized LIKE ? ${LIKE_ESCAPE})`); bindings.push(`%${escapeLike(query)}%`, `%${escapeLike(query)}%`, `%${escapeLike(normalizePhone(query) || query)}%`); }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const [result, count] = await Promise.all([
    env.DB.prepare(`${appointmentSelect} ${where} ORDER BY julianday(a.starts_at) DESC LIMIT ? OFFSET ?`).bind(...bindings, pageSize, (page - 1) * pageSize).all(),
    env.DB.prepare(`SELECT COUNT(*) AS value FROM appointments a INNER JOIN clients c ON c.id = a.client_id ${where}`).bind(...bindings).first<{ value: number }>(),
  ]);
  const total = Number(count?.value ?? 0);
  return json({ ok: true, items: result.results ?? [], total, page, pageSize, pages: Math.ceil(total / pageSize), filters: { from, to, branchId: branchId ?? null, employeeId: employeeId ?? null, status: status ?? null } });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "appointments.write")) return forbidden();
  const body = await readJson(request);
  // datetime-local input has no zone: interpret wall-clock time at the centre.
  const timezone = await organizationTimezone(env.DB);
  const startsAt = zonedDateValue(body, "startsAt", timezone);
  const branchId = optionalString(body, "branchId");
  const employeeId = optionalString(body, "employeeId");
  const clientIdFromBody = optionalString(body, "clientId");
  const clientName = boundedString(body, "clientName", 200);
  const clientPhoneRaw = boundedString(body, "clientPhone", 40);
  const notes = optionalString(body, "notes", 2000);
  const serviceIds = [...new Set(serviceIdsFromBody(body))];
  if (serviceIds.length > 20) return badRequest("В одну запись можно добавить не более 20 услуг");
  const idempotencyKey = stringValue(body, "idempotencyKey");
  if (idempotencyKey.length > 128) return badRequest("Некорректный ключ операции");
  const requestHash = JSON.stringify([startsAt, branchId, employeeId, clientIdFromBody, clientName, clientPhoneRaw, [...serviceIds].sort(), notes, body.status ?? "SCHEDULED"]);
  if (idempotencyKey) {
    const replay = await env.DB.prepare("SELECT appointment_id AS id, user_id AS userId, request_hash AS requestHash FROM booking_idempotency_keys WHERE idempotency_key = ?").bind(idempotencyKey).first<{ id: string; userId: string; requestHash: string }>();
    if (replay && replay.userId !== user.id) return conflict("Этот ключ уже использован");
    if (replay) return replay.requestHash === requestHash ? json({ ok: true, id: replay.id, replayed: true }) : conflict("Этот ключ уже использован для другой записи");
  }
  const ownId = await ownEmployeeId(env, user.id, user.role);
  if (!startsAt || !branchId || !employeeId || !serviceIds.length) return badRequest("Дата, филиал, специалист, клиент и услуги обязательны");
  if (user.role === "SPECIALIST" && employeeId !== ownId) return forbidden("Специалист может создавать записи только к себе");

  const [branch, employee] = await Promise.all([
    env.DB.prepare("SELECT id, name FROM branches WHERE id = ? AND is_active = 1").bind(branchId).first<{ id: string; name: string }>(),
    env.DB.prepare("SELECT e.id, e.full_name AS fullName FROM employees e WHERE e.id = ? AND e.is_active = 1 AND EXISTS (SELECT 1 FROM employee_branches eb WHERE eb.employee_id = e.id AND eb.branch_id = ?)").bind(employeeId, branchId).first<{ id: string; fullName: string }>(),
  ]);
  if (!branch) return badRequest("Филиал не найден или архивирован");
  if (!employee) return badRequest("Специалист не работает в выбранном филиале");

  let clientId = clientIdFromBody;
  const statements: D1PreparedStatement[] = [];
  if (clientId) {
    const client = await env.DB.prepare("SELECT id FROM clients WHERE id = ? AND is_active = 1").bind(clientId).first<{ id: string }>();
    if (!client) return badRequest("Клиент не найден или архивирован");
  } else {
    const normalized = requirePhone(normalizePhone(clientPhoneRaw));
    if (!clientName || clientName.length < 2 || !normalized) return badRequest("Укажите клиента или имя с корректным телефоном", { clientPhone: "Введите 10 цифр после +7" });
    const existingClient = await env.DB.prepare("SELECT id FROM clients WHERE phone_normalized = ? AND is_active = 1 LIMIT 1").bind(normalized).first<{ id: string }>();
    clientId = existingClient?.id ?? newId();
    if (!existingClient) statements.push(env.DB.prepare("INSERT INTO clients (id, full_name, phone, phone_normalized, is_active) VALUES (?, ?, ?, ?, 1)").bind(clientId, clientName, clientPhoneRaw, normalized));
  }

  const placeholders = serviceIds.map(() => "?").join(",");
  const serviceResult = await env.DB.prepare(`SELECT id, name, price, duration_minutes AS durationMinutes FROM services WHERE id IN (${placeholders}) AND is_active = 1`).bind(...serviceIds).all<{ id: string; name: string; price: number; durationMinutes: number }>();
  const services = serviceResult.results ?? [];
  if (services.length !== serviceIds.length) return badRequest("Одна из услуг не найдена или архивирована");
  const eligibility = await env.DB.prepare(`
    SELECT COUNT(DISTINCT es.service_id) AS count
    FROM employee_services es
    WHERE es.employee_id = ? AND es.active = 1 AND es.service_id IN (${serviceIds.map(() => "?").join(",")})
      AND (es.branch_id IS NULL OR es.branch_id = ?)
  `).bind(employeeId, ...serviceIds, branchId).first<{ count: number }>();
  if (Number(eligibility?.count ?? 0) !== serviceIds.length) return badRequest("Специалист не оказывает одну из услуг в выбранном филиале");
  const total = services.reduce((sum, service) => sum.plus(new Decimal(service.price ?? 0)), new Decimal(0));
  const duration = services.reduce((sum, service) => sum + Math.max(15, Number(service.durationMinutes ?? 60)), 0);
  const startMs = new Date(startsAt).getTime();
  const endsAt = new Date(startMs + duration * 60_000).toISOString();
  if (!Number.isFinite(startMs) || startMs <= Date.now() - 5 * 60_000) return badRequest("Время записи должно быть в будущем");

  const scheduleError = await scheduleConflict(env.DB, employeeId, branchId, startsAt, endsAt);
  if (scheduleError) return badRequest(scheduleError);
  const conflictRow = await env.DB.prepare(`
    SELECT id FROM appointments
    WHERE employee_id = ? AND status NOT IN ('CANCELLED', 'NO_SHOW')
      AND julianday(starts_at) < julianday(?) AND julianday(COALESCE(ends_at, datetime(starts_at, '+60 minutes'))) > julianday(?) LIMIT 1
  `).bind(employeeId, endsAt, startsAt).first<{ id: string }>();
  if (conflictRow) return conflict("У специалиста уже есть пересекающаяся запись");

  const id = newId();
  const statusValue = stringValue(body, "status", "SCHEDULED").toUpperCase();
  if (!["SCHEDULED", "CONFIRMED"].includes(statusValue)) return badRequest("Новая запись может быть только запланирована или подтверждена");
  const status = statusValue;
  const sourceValue = stringValue(body, "source", "ADMIN").toUpperCase();
  const source = sources.has(sourceValue) ? sourceValue : "ADMIN";
  statements.push(env.DB.prepare(`INSERT INTO appointments (id, client_id, employee_id, branch_id, starts_at, ends_at, status, source, total_amount, notes, check_in_token, created_by, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, clientId, employeeId, branchId, startsAt, endsAt, status, source, Number(total.toFixed(2)), notes, newCheckInToken(), user.id, user.id));
  for (const service of services) {
    statements.push(env.DB.prepare("INSERT INTO appointment_services (appointment_id, service_id, price, duration_minutes, quantity) VALUES (?, ?, ?, ?, 1)").bind(id, service.id, Number(new Decimal(service.price ?? 0).toFixed(2)), service.durationMinutes));
  }
  statements.push(...reservationStatements(env.DB, id, employeeId, startsAt, endsAt));
  statements.push(
    env.DB.prepare("INSERT INTO appointment_status_history (id, appointment_id, from_status, to_status, actor_id, note) VALUES (?, ?, NULL, ?, ?, ?)").bind(newId(), id, status, user.id, "Запись создана"),
    auditStatement(env.DB, user, "appointment", id, "CREATE", null, { clientId, employeeId, branchId, startsAt, endsAt, status, totalAmount: total.toFixed(2) }),
  );
  const reminder24 = new Date(startMs - 24 * 60 * 60_000);
  const reminder2 = new Date(startMs - 2 * 60 * 60_000);
  if (clientId) {
    statements.push(env.DB.prepare("UPDATE follow_ups SET status = 'BOOKED', completed_at = CURRENT_TIMESTAMP, completed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE client_id = ? AND status = 'OPEN'").bind(user.id, clientId));
    const reminders: Array<readonly [string, Date]> = [["REMINDER_24H", reminder24], ["REMINDER_2H", reminder2]];
    for (const [kind, scheduledAt] of reminders) {
      if (scheduledAt.getTime() > Date.now()) statements.push(env.DB.prepare("INSERT INTO notifications (id, user_id, client_id, appointment_id, kind, scheduled_at, payload_json) VALUES (?, (SELECT id FROM users WHERE client_id = ? AND active = 1 LIMIT 1), ?, ?, ?, ?, ?)").bind(newId(), clientId, clientId, id, kind, scheduledAt.toISOString(), JSON.stringify({ appointmentId: id, startsAt })));
    }
    const recipient = await env.DB.prepare(`
      SELECT u.telegram_id AS telegramId, u.notifications_allowed AS notificationsAllowed, c.full_name AS clientName
      FROM users u INNER JOIN clients c ON c.id = u.client_id
      WHERE c.id = ? AND u.active = 1 AND u.notifications_allowed = 1 LIMIT 1
    `).bind(clientId).first<{ telegramId: string; notificationsAllowed: number; clientName: string }>();
    if (recipient) {
      statements.push(env.DB.prepare("INSERT OR IGNORE INTO message_outbox (id, event_key, telegram_id, template_key, payload_json) VALUES (?, ?, ?, 'BOOKING_CONFIRMED', ?)")
        .bind(newId(), `appointment:${id}:confirmed:staff`, recipient.telegramId, JSON.stringify({ clientName: recipient.clientName, date: new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: timezone }).format(new Date(startsAt)), time: new Intl.DateTimeFormat("ru-RU", { timeStyle: "short", timeZone: timezone }).format(new Date(startsAt)), specialist: employee.fullName, service: services.map((service) => service.name).join(", ") || "Приём", branch: branch.name })));
    }
  }
  try {
    if (idempotencyKey) statements.push(env.DB.prepare("INSERT INTO booking_idempotency_keys(idempotency_key, user_id, appointment_id, request_hash) VALUES(?, ?, ?, ?)").bind(idempotencyKey, user.id, id, requestHash));
    await env.DB.batch(statements);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    if (idempotencyKey) {
      const replay = await env.DB.prepare("SELECT appointment_id AS id, request_hash AS requestHash FROM booking_idempotency_keys WHERE idempotency_key = ? AND user_id = ?").bind(idempotencyKey, user.id).first<{ id: string; requestHash: string }>();
      if (replay && replay.requestHash === requestHash) return json({ ok: true, id: replay.id, replayed: true });
    }
    if (/CRM_DUPLICATE_PHONE/.test(message)) return conflict("Клиент с таким телефоном уже есть в базе. Выберите его из списка.");
    if (/CRM_SLOT_UNAVAILABLE|unique|constraint|appointment_slot_reservations|idx_appointments_active_employee_start/i.test(message)) return conflict("У специалиста уже есть пересекающаяся запись");
    return json({ ok: false, error: "Не удалось сохранить запись. Попробуйте ещё раз." }, 500);
  }
  return json({ ok: true, id, startsAt, endsAt, totalAmount: total.toFixed(2) }, 201);
};
