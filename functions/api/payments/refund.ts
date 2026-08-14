import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, conflict, dateValue, json, newId, readJson, stringValue } from "../../_lib/http";
import { nonNegativeNumber } from "../../_lib/validation";

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "payments.write")) return forbidden();
  const body = await readJson(request);
  const paymentId = stringValue(body, "paymentId");
  const amount = nonNegativeNumber(body.amount, "Сумма возврата");
  const reason = stringValue(body, "reason");
  const idempotencyKey = stringValue(body, "idempotencyKey") || newId();
  if (!paymentId || amount === null || amount <= 0 || !reason) return badRequest("Укажите платёж, положительную сумму и причину возврата");
  if (idempotencyKey.length > 128) return badRequest("Некорректный ключ повторной отправки");
  const requestHash = [paymentId, amount.toFixed(2), reason].join("|");
  const previousAdjustment = await env.DB.prepare("SELECT adjustment_id AS adjustmentId, user_id AS userId, request_hash AS requestHash FROM refund_idempotency_keys WHERE idempotency_key = ? LIMIT 1").bind(idempotencyKey).first<{ adjustmentId: string; userId: string; requestHash: string }>();
  if (previousAdjustment && previousAdjustment.userId !== user.id) return conflict("Этот ключ уже использован");
  if (previousAdjustment && previousAdjustment.requestHash !== requestHash) return conflict("Этот ключ уже использован для другого возврата");
  if (previousAdjustment) return json({ ok: true, id: previousAdjustment.adjustmentId, replayed: true });
  const payment = await env.DB.prepare("SELECT p.id, p.amount, p.appointment_id AS appointmentId, a.branch_id AS branchId, p.payment_status AS status FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id WHERE p.id = ?").bind(paymentId).first<{ id: string; amount: number; appointmentId: string; branchId: string; status: string }>();
  if (!payment || payment.status !== "POSTED") return badRequest("Платёж не найден или уже закрыт");
  const refunded = await env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS value FROM payment_adjustments WHERE payment_id = ?").bind(paymentId).first<{ value: number }>();
  const available = Number(payment.amount ?? 0) - Number(refunded?.value ?? 0);
  if (amount > available + 0.005) return conflict(`Нельзя вернуть больше доступной суммы: ${Math.max(0, available).toFixed(2)} ₸`);
  const occurredAt = dateValue(body, "occurredAt") || new Date().toISOString();
  const adjustmentId = newId();
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO payment_adjustments (id, payment_id, appointment_id, kind, amount, reason, occurred_at, created_by)
        SELECT ?, p.id, p.appointment_id, 'REFUND', ?, ?, ?, ?
        FROM payments p
        WHERE p.id = ? AND p.payment_status = 'POSTED'
          AND ? <= p.amount - COALESCE((SELECT SUM(pa.amount) FROM payment_adjustments pa WHERE pa.payment_id = p.id), 0)
      `).bind(adjustmentId, amount, reason, occurredAt, user.id, paymentId, amount),
      env.DB.prepare(`INSERT INTO financial_transactions (id, direction, kind, category, amount, status, occurred_at, branch_id, appointment_id, payment_id, description, created_by)
        SELECT ?, 'INCOME', 'REFUND', 'REFUND', ?, 'POSTED', ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM payment_adjustments WHERE id = ?)`)
        .bind(newId(), amount, occurredAt, payment.branchId, payment.appointmentId, paymentId, reason, user.id, adjustmentId),
      env.DB.prepare("INSERT INTO refund_idempotency_keys (idempotency_key, user_id, adjustment_id, request_hash) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM payment_adjustments WHERE id = ?)")
        .bind(idempotencyKey, user.id, adjustmentId, requestHash, adjustmentId),
      env.DB.prepare(`INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action, before_json, after_json)
        SELECT ?, ?, 'payment', ?, 'REFUND', ?, ? WHERE EXISTS (SELECT 1 FROM payment_adjustments WHERE id = ?)`)
        .bind(newId(), user.id, paymentId, JSON.stringify({ amount: payment.amount, refunded: refunded?.value ?? 0 }), JSON.stringify({ refundAmount: amount, reason, adjustmentId }), adjustmentId),
    ]);
    if (Number(results[0]?.meta.changes ?? 0) !== 1) return conflict("Возврат превышает актуальный остаток платежа");
  } catch (error) {
    if (/unique|constraint/i.test(error instanceof Error ? error.message : "")) {
      const replay = await env.DB.prepare("SELECT adjustment_id AS adjustmentId, request_hash AS requestHash FROM refund_idempotency_keys WHERE idempotency_key = ? AND user_id = ? LIMIT 1").bind(idempotencyKey, user.id).first<{ adjustmentId: string; requestHash: string }>();
      if (replay && replay.requestHash === requestHash) return json({ ok: true, id: replay.adjustmentId, replayed: true });
    }
    return json({ ok: false, error: "Не удалось сохранить возврат" }, 500);
  }
  const actualRefund = await env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS value FROM payment_adjustments WHERE payment_id = ?").bind(paymentId).first<{ value: number }>();
  const refundedAmount = Number(actualRefund?.value ?? 0);
  return json({ ok: true, id: adjustmentId, refundedAmount, balance: Math.max(0, Number(payment.amount ?? 0) - refundedAmount) }, 201);
};
