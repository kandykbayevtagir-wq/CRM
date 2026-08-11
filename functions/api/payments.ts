import { auditStatement } from "../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, conflict, dateValue, json, newId, optionalString, readJson, stringValue } from "../_lib/http";
import { nonNegativeNumber } from "../_lib/validation";

const methods = new Set(["CASH", "CARD", "TRANSFER", "QR", "OTHER"]);

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "payments.read")) return forbidden();
  const params = new URL(request.url).searchParams;
  const appointmentId = params.get("appointmentId")?.trim();
  const rows = await env.DB.prepare(`
    SELECT p.id, p.appointment_id AS appointmentId, p.amount, p.method, p.payment_status AS status, p.paid_at AS paidAt, p.note,
      a.total_amount AS appointmentAmount, c.full_name AS clientName,
      COALESCE((SELECT SUM(pa.amount) FROM payment_adjustments pa WHERE pa.payment_id = p.id), 0) AS refundedAmount
    FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id INNER JOIN clients c ON c.id = a.client_id
    ${appointmentId ? "WHERE p.appointment_id = ?" : ""} ORDER BY p.paid_at DESC LIMIT 300
  `).bind(...(appointmentId ? [appointmentId] : [])).all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "payments.write")) return forbidden();
  const body = await readJson(request);
  const appointmentId = stringValue(body, "appointmentId");
  const amount = nonNegativeNumber(body.amount, "Сумма");
  const methodValue = stringValue(body, "method", "CASH").toUpperCase();
  const method = methods.has(methodValue) ? methodValue : "";
  const idempotencyKey = optionalString(body, "idempotencyKey") || newId();
  if (!appointmentId || amount === null || amount <= 0 || !method) return badRequest("Укажите запись, положительную сумму и способ оплаты");
  if (idempotencyKey.length > 128) return badRequest("Некорректный ключ повторной отправки");
  const requestHash = [appointmentId, amount.toFixed(2), method].join("|");
  const previousPayment = await env.DB.prepare("SELECT payment_id AS paymentId, request_hash AS requestHash FROM payment_idempotency_keys WHERE idempotency_key = ? AND user_id = ? LIMIT 1").bind(idempotencyKey, user.id).first<{ paymentId: string; requestHash: string }>();
  if (previousPayment && previousPayment.requestHash !== requestHash) return conflict("Этот ключ уже использован для другой оплаты");
  if (previousPayment) return json({ ok: true, id: previousPayment.paymentId, paymentId: previousPayment.paymentId, replayed: true });
  const appointment = await env.DB.prepare("SELECT id, branch_id AS branchId, total_amount AS totalAmount, status FROM appointments WHERE id = ?").bind(appointmentId).first<{ id: string; branchId: string; totalAmount: number; status: string }>();
  if (!appointment) return badRequest("Запись не найдена");
  if (["CANCELLED", "NO_SHOW"].includes(appointment.status)) return badRequest("Нельзя принять оплату по отменённой записи");
  const paid = await env.DB.prepare("SELECT COALESCE(SUM(p.amount), 0) - COALESCE((SELECT SUM(pa.amount) FROM payment_adjustments pa INNER JOIN payments rp ON rp.id = pa.payment_id WHERE rp.appointment_id = ?), 0) AS value FROM payments p WHERE p.appointment_id = ? AND p.payment_status = 'POSTED'")
    .bind(appointmentId, appointmentId).first<{ value: number }>();
  const balance = Number(appointment.totalAmount ?? 0) - Number(paid?.value ?? 0);
  if (amount > balance + 0.005) return conflict(`Сумма превышает остаток: ${Math.max(0, balance).toFixed(2)} ₸`);
  const paidAt = dateValue(body, "paidAt") || new Date().toISOString();
  const paymentId = newId();
  const transactionId = newId();
  const dbMethod = method === "QR" ? "TRANSFER" : method;
  const note = method === "QR" ? `[QR] ${optionalString(body, "note") ?? ""}`.trim() : optionalString(body, "note");
  try {
    await env.DB.batch([
    env.DB.prepare("INSERT INTO payments (id, appointment_id, amount, method, payment_status, paid_at, note, created_by) VALUES (?, ?, ?, ?, 'POSTED', ?, ?, ?)").bind(paymentId, appointmentId, amount, dbMethod, paidAt, note, user.id),
    env.DB.prepare("INSERT INTO financial_transactions (id, direction, kind, category, amount, status, occurred_at, branch_id, appointment_id, payment_id, description, created_by) VALUES (?, 'INCOME', 'PAYMENT', 'SERVICE', ?, 'POSTED', ?, ?, ?, ?, ?, ?)").bind(transactionId, amount, paidAt, appointment.branchId, appointmentId, paymentId, note ?? "Оплата услуги", user.id),
    env.DB.prepare("INSERT INTO payment_idempotency_keys (idempotency_key, user_id, payment_id, request_hash) VALUES (?, ?, ?, ?)").bind(idempotencyKey, user.id, paymentId, requestHash),
    auditStatement(env.DB, user, "payment", paymentId, "CREATE", null, { appointmentId, amount, method, paidAt }),
    ]);
  } catch (error) {
    if (/unique|constraint/i.test(error instanceof Error ? error.message : "")) {
      const replay = await env.DB.prepare("SELECT payment_id AS paymentId, request_hash AS requestHash FROM payment_idempotency_keys WHERE idempotency_key = ? AND user_id = ? LIMIT 1").bind(idempotencyKey, user.id).first<{ paymentId: string; requestHash: string }>();
      if (replay && replay.requestHash === requestHash) return json({ ok: true, id: replay.paymentId, paymentId: replay.paymentId, replayed: true });
    }
    return json({ ok: false, error: "Не удалось сохранить оплату" }, 500);
  }
  return json({ ok: true, id: paymentId, paymentId, paidAmount: Number(paid?.value ?? 0) + amount, balance: Math.max(0, balance - amount) }, 201);
};
