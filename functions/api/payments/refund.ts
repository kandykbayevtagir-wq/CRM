import { auditStatement } from "../../_lib/audit";
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
  if (!paymentId || amount === null || amount <= 0 || !reason) return badRequest("Укажите платёж, положительную сумму и причину возврата");
  const payment = await env.DB.prepare("SELECT p.id, p.amount, p.appointment_id AS appointmentId, a.branch_id AS branchId, p.payment_status AS status FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id WHERE p.id = ?").bind(paymentId).first<{ id: string; amount: number; appointmentId: string; branchId: string; status: string }>();
  if (!payment || payment.status !== "POSTED") return badRequest("Платёж не найден или уже закрыт");
  const refunded = await env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS value FROM payment_adjustments WHERE payment_id = ?").bind(paymentId).first<{ value: number }>();
  const available = Number(payment.amount ?? 0) - Number(refunded?.value ?? 0);
  if (amount > available + 0.005) return conflict(`Нельзя вернуть больше доступной суммы: ${Math.max(0, available).toFixed(2)} ₸`);
  const occurredAt = dateValue(body, "occurredAt") || new Date().toISOString();
  const adjustmentId = newId();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO payment_adjustments (id, payment_id, appointment_id, kind, amount, reason, occurred_at, created_by) VALUES (?, ?, ?, 'REFUND', ?, ?, ?, ?)").bind(adjustmentId, paymentId, payment.appointmentId, amount, reason, occurredAt, user.id),
    env.DB.prepare("INSERT INTO financial_transactions (id, direction, kind, category, amount, status, occurred_at, branch_id, appointment_id, payment_id, description, created_by) VALUES (?, 'INCOME', 'REFUND', 'REFUND', ?, 'POSTED', ?, ?, ?, ?, ?, ?)").bind(newId(), amount, occurredAt, payment.branchId, payment.appointmentId, paymentId, reason, user.id),
    auditStatement(env.DB, user, "payment", paymentId, "REFUND", { amount: payment.amount, refunded: refunded?.value ?? 0 }, { refundAmount: amount, reason, adjustmentId }),
  ]);
  return json({ ok: true, id: adjustmentId, refundedAmount: Number(refunded?.value ?? 0) + amount, balance: available - amount }, 201);
};
