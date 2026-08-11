import Decimal from "decimal.js";

import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { json } from "../_lib/http";

type Check = {
  key: string;
  label: string;
  sourceAmount: number;
  ledgerAmount: number;
  difference: number;
  sourceCount: number;
  ledgerCount: number;
  ok: boolean;
};

function amount(value: number | string | null | undefined) {
  return Number(new Decimal(value ?? 0).toFixed(2));
}

function check(key: string, label: string, source: { amount: number | string | null; count: number | string | null }, ledger: { amount: number | string | null; count: number | string | null }): Check {
  const sourceAmount = amount(source.amount);
  const ledgerAmount = amount(ledger.amount);
  return {
    key,
    label,
    sourceAmount,
    ledgerAmount,
    difference: amount(new Decimal(sourceAmount).minus(ledgerAmount).abs().toNumber()),
    sourceCount: Number(source.count ?? 0),
    ledgerCount: Number(ledger.count ?? 0),
    ok: new Decimal(sourceAmount).minus(ledgerAmount).abs().lte(0.01) && Number(source.count ?? 0) === Number(ledger.count ?? 0),
  };
}

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "finance.read")) return forbidden();
  const [payments, paymentLedger, refunds, refundLedger, payroll, payrollLedger, rent, rentLedger, utilities, utilitiesLedger] = await Promise.all([
    env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count FROM payments WHERE payment_status = 'POSTED'").first<{ amount: number; count: number }>(),
    env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count FROM financial_transactions WHERE kind = 'PAYMENT' AND direction = 'INCOME' AND status = 'POSTED' AND payment_id IS NOT NULL").first<{ amount: number; count: number }>(),
    env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count FROM payment_adjustments WHERE kind = 'REFUND'").first<{ amount: number; count: number }>(),
    env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count FROM financial_transactions WHERE kind = 'REFUND' AND status = 'POSTED' AND payment_id IS NOT NULL").first<{ amount: number; count: number }>(),
    env.DB.prepare("SELECT COALESCE(SUM(total_amount), 0) AS amount, COUNT(*) AS count FROM payroll_periods WHERE status = 'CLOSED'").first<{ amount: number; count: number }>(),
    env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count FROM financial_transactions WHERE kind = 'SALARY' AND status = 'POSTED' AND payroll_period_id IS NOT NULL").first<{ amount: number; count: number }>(),
    env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count FROM rent_payments WHERE status = 'PAID'").first<{ amount: number; count: number }>(),
    env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count FROM financial_transactions WHERE kind = 'RENT' AND status = 'POSTED' AND rent_payment_id IS NOT NULL").first<{ amount: number; count: number }>(),
    env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count FROM utility_payments WHERE status = 'PAID'").first<{ amount: number; count: number }>(),
    env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count FROM financial_transactions WHERE kind = 'UTILITIES' AND status = 'POSTED' AND utility_payment_id IS NOT NULL").first<{ amount: number; count: number }>(),
  ]);
  const checks = [
    check("payments", "Оплаты ↔ финансовый журнал", payments ?? { amount: 0, count: 0 }, paymentLedger ?? { amount: 0, count: 0 }),
    check("refunds", "Возвраты ↔ финансовый журнал", refunds ?? { amount: 0, count: 0 }, refundLedger ?? { amount: 0, count: 0 }),
    check("payroll", "Закрытая зарплата ↔ финансовый журнал", payroll ?? { amount: 0, count: 0 }, payrollLedger ?? { amount: 0, count: 0 }),
    check("rent", "Аренда ↔ финансовый журнал", rent ?? { amount: 0, count: 0 }, rentLedger ?? { amount: 0, count: 0 }),
    check("utilities", "Коммунальные ↔ финансовый журнал", utilities ?? { amount: 0, count: 0 }, utilitiesLedger ?? { amount: 0, count: 0 }),
  ];
  return json({ ok: true, healthy: checks.every((item) => item.ok), checks, checkedAt: new Date().toISOString() });
};
