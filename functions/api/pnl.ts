import Decimal from "decimal.js";
import { calculateContributionMargin, calculateOperatingProfit } from "../../src/lib/finance/business";

import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { json } from "../_lib/http";

function range(request: Request) {
  const params = new URL(request.url).searchParams;
  const now = new Date();
  const from = params.get("from") ? new Date(params.get("from") as string) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = params.get("to") ? new Date(params.get("to") as string) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from: Number.isNaN(from.getTime()) ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) : from, to: Number.isNaN(to.getTime()) ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) : to };
}

function filters(request: Request, alias = "a") {
  const params = new URL(request.url).searchParams;
  const conditions = [`${alias}.starts_at >= ?`, `${alias}.starts_at < ?`];
  const bindings: string[] = [];
  const branchId = params.get("branchId")?.trim() ?? "";
  const employeeId = params.get("employeeId")?.trim() ?? "";
  const serviceId = params.get("serviceId")?.trim() ?? "";
  const category = params.get("category")?.trim() ?? "";
  if (branchId) { conditions.push(`${alias}.branch_id = ?`); bindings.push(branchId); }
  if (employeeId) { conditions.push(`${alias}.employee_id = ?`); bindings.push(employeeId); }
  if (serviceId) { conditions.push(`EXISTS (SELECT 1 FROM appointment_services sf WHERE sf.appointment_id = ${alias}.id AND sf.service_id = ?)`); bindings.push(serviceId); }
  if (category) { conditions.push(`EXISTS (SELECT 1 FROM appointment_services sc INNER JOIN services svc ON svc.id = sc.service_id WHERE sc.appointment_id = ${alias}.id AND svc.category = ?)`); bindings.push(category); }
  return { conditions, bindings, branchId, employeeId, serviceId, category };
}

export async function metricSnapshot(db: D1Database, from: string, to: string, request: Request) {
  const scope = filters(request);
  const where = scope.conditions.join(" AND ");
  const payrollConditions = ["pp.period_start < ?", "pp.period_end >= ?"];
  const payrollBindings: string[] = [to, from];
  if (scope.employeeId) { payrollConditions.push("l.employee_id = ?"); payrollBindings.push(scope.employeeId); }
  if (scope.branchId) { payrollConditions.push("EXISTS (SELECT 1 FROM employee_branches payroll_eb WHERE payroll_eb.employee_id = l.employee_id AND payroll_eb.branch_id = ?)"); payrollBindings.push(scope.branchId); }
  const [revenue, refunds, consumables, expenses, payroll, counts, lines, daily, expenseGroups] = await Promise.all([
    db.prepare(`SELECT COALESCE(SUM(p.amount), 0) AS value FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id WHERE a.status = 'COMPLETED' AND p.payment_status = 'POSTED' AND p.paid_at >= ? AND p.paid_at < ? AND ${where}`).bind(from, to, ...scope.bindings).first<{ value: number }>(),
    db.prepare(`SELECT COALESCE(SUM(pa.amount), 0) AS value FROM payment_adjustments pa INNER JOIN payments p ON p.id = pa.payment_id INNER JOIN appointments a ON a.id = p.appointment_id WHERE a.status = 'COMPLETED' AND pa.occurred_at >= ? AND pa.occurred_at < ? AND ${where}`).bind(from, to, ...scope.bindings).first<{ value: number }>(),
    db.prepare(`SELECT COALESCE(SUM(ic.total_cost), 0) AS value FROM inventory_consumptions ic INNER JOIN appointments a ON a.id = ic.appointment_id WHERE a.status = 'COMPLETED' AND a.starts_at >= ? AND a.starts_at < ? AND ${where}`).bind(from, to, ...scope.bindings).first<{ value: number }>(),
    db.prepare(`SELECT COALESCE(SUM(x.amount), 0) AS value FROM financial_transactions x WHERE x.status = 'POSTED' AND x.direction = 'EXPENSE' AND x.kind NOT IN ('SALARY', 'RENT', 'UTILITIES') AND x.occurred_at >= ? AND x.occurred_at < ?${scope.branchId ? " AND x.branch_id = ?" : ""}`).bind(from, to, ...(scope.branchId ? [scope.branchId] : [])).first<{ value: number }>(),
    db.prepare(`SELECT COALESCE(SUM(l.total_amount), 0) AS value FROM payroll_lines l INNER JOIN payroll_periods pp ON pp.id = l.period_id WHERE pp.status IN ('CALCULATED', 'CLOSED') AND ${payrollConditions.join(" AND ")}`).bind(...payrollBindings).first<{ value: number }>(),
    db.prepare(`SELECT COUNT(*) AS appointments, SUM(CASE WHEN a.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed, SUM(CASE WHEN a.status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled, SUM(CASE WHEN a.status = 'NO_SHOW' THEN 1 ELSE 0 END) AS noShow FROM appointments a WHERE ${where}`).bind(from, to, ...scope.bindings).first<{ appointments: number; completed: number; cancelled: number; noShow: number }>(),
    db.prepare(`SELECT a.id, a.starts_at AS startsAt, a.employee_id AS employeeId, e.full_name AS employeeName, a.branch_id AS branchId, s.id AS serviceId, s.name AS serviceName, s.category, aps.price, aps.quantity, a.total_amount AS appointmentAmount,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.appointment_id = a.id AND p.payment_status = 'POSTED' AND p.paid_at >= ? AND p.paid_at < ?), 0) AS paidAmount,
      COALESCE((SELECT SUM(pa.amount) FROM payment_adjustments pa INNER JOIN payments rp ON rp.id = pa.payment_id WHERE rp.appointment_id = a.id AND pa.occurred_at >= ? AND pa.occurred_at < ?), 0) AS refundedAmount,
      COALESCE((SELECT SUM(ic.total_cost) FROM inventory_consumptions ic WHERE ic.appointment_id = a.id AND ic.service_id = aps.service_id), 0) AS consumablesCost,
      COALESCE((SELECT commission_percent FROM employee_services es WHERE es.employee_id = a.employee_id AND es.service_id = aps.service_id AND es.active = 1 AND (es.branch_id = a.branch_id OR es.branch_id IS NULL) ORDER BY es.branch_id IS NULL LIMIT 1), e.revenue_percent) AS commissionPercent
      FROM appointments a INNER JOIN appointment_services aps ON aps.appointment_id = a.id INNER JOIN services s ON s.id = aps.service_id LEFT JOIN employees e ON e.id = a.employee_id WHERE a.status = 'COMPLETED' AND ${where}`).bind(from, to, from, to, from, to, ...scope.bindings).all<Record<string, unknown>>(),
    db.prepare(`SELECT day, COALESCE(SUM(amount), 0) AS amount FROM (
      SELECT date(p.paid_at, 'localtime') AS day, p.amount AS amount FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id WHERE a.status = 'COMPLETED' AND p.payment_status = 'POSTED' AND p.paid_at >= ? AND p.paid_at < ? AND ${where}
      UNION ALL
      SELECT date(pa.occurred_at, 'localtime') AS day, -pa.amount AS amount FROM payment_adjustments pa INNER JOIN payments rp ON rp.id = pa.payment_id INNER JOIN appointments a ON a.id = rp.appointment_id WHERE a.status = 'COMPLETED' AND pa.occurred_at >= ? AND pa.occurred_at < ? AND ${where}
    ) GROUP BY day ORDER BY day`).bind(from, to, ...scope.bindings, from, to, ...scope.bindings).all<{ day: string; amount: number }>(),
    db.prepare(`SELECT x.kind AS category, COALESCE(SUM(x.amount), 0) AS amount FROM financial_transactions x WHERE x.status = 'POSTED' AND x.direction = 'EXPENSE' AND x.occurred_at >= ? AND x.occurred_at < ?${scope.branchId ? " AND x.branch_id = ?" : ""} GROUP BY x.kind ORDER BY amount DESC`).bind(from, to, ...(scope.branchId ? [scope.branchId] : [])).all<{ category: string; amount: number }>(),
  ]);
  const grossRevenue = new Decimal(revenue?.value ?? 0);
  const refundAmount = new Decimal(refunds?.value ?? 0);
  const netRevenue = grossRevenue.minus(refundAmount);
  const consumablesCost = new Decimal(consumables?.value ?? 0);
  const payrollAmount = new Decimal(payroll?.value ?? 0);
  const otherExpenses = new Decimal(expenses?.value ?? 0);
  const rent = await db.prepare(`SELECT COALESCE(SUM(x.amount), 0) AS value FROM financial_transactions x WHERE x.status = 'POSTED' AND x.direction = 'EXPENSE' AND x.kind = 'RENT' AND x.occurred_at >= ? AND x.occurred_at < ?${scope.branchId ? " AND x.branch_id = ?" : ""}`).bind(from, to, ...(scope.branchId ? [scope.branchId] : [])).first<{ value: number }>();
  const utilities = await db.prepare(`SELECT COALESCE(SUM(x.amount), 0) AS value FROM financial_transactions x WHERE x.status = 'POSTED' AND x.direction = 'EXPENSE' AND x.kind = 'UTILITIES' AND x.occurred_at >= ? AND x.occurred_at < ?${scope.branchId ? " AND x.branch_id = ?" : ""}`).bind(from, to, ...(scope.branchId ? [scope.branchId] : [])).first<{ value: number }>();
  const rentAmount = new Decimal(rent?.value ?? 0);
  const utilityAmount = new Decimal(utilities?.value ?? 0);
  const grossProfit = netRevenue.minus(consumablesCost);
  const operatingProfit = new Decimal(calculateOperatingProfit({ netRevenue: netRevenue.toString(), payroll: payrollAmount.toString(), rent: rentAmount.toString(), utilities: utilityAmount.toString(), consumables: consumablesCost.toString(), otherExpenses: otherExpenses.toString() }));
  const serviceMap = new Map<string, { serviceId: string; serviceName: string; category: string; revenue: Decimal; consumables: Decimal; commission: Decimal; appointments: number }>();
  const employeeMap = new Map<string, { employeeId: string; employeeName: string; revenue: Decimal; consumables: Decimal; commission: Decimal; appointments: number }>();
  for (const row of lines.results ?? []) {
    const appointmentAmount = new Decimal(row.appointmentAmount as number ?? 0);
    const lineAmount = new Decimal(row.price as number ?? 0).mul(Number(row.quantity ?? 1));
    const netPaid = new Decimal(row.paidAmount as number ?? 0).minus(new Decimal(row.refundedAmount as number ?? 0));
    const allocatedRevenue = appointmentAmount.gt(0) ? lineAmount.div(appointmentAmount).mul(netPaid) : new Decimal(0);
    const materialCost = new Decimal(row.consumablesCost as number ?? 0);
    const commission = allocatedRevenue.mul(new Decimal(row.commissionPercent as number ?? 0)).div(100);
    const serviceId = String(row.serviceId);
    const service = serviceMap.get(serviceId) ?? { serviceId, serviceName: String(row.serviceName), category: String(row.category), revenue: new Decimal(0), consumables: new Decimal(0), commission: new Decimal(0), appointments: 0 };
    service.revenue = service.revenue.plus(allocatedRevenue); service.consumables = service.consumables.plus(materialCost); service.commission = service.commission.plus(commission); service.appointments += 1; serviceMap.set(serviceId, service);
    const employeeId = String(row.employeeId ?? "unknown");
    const employee = employeeMap.get(employeeId) ?? { employeeId, employeeName: String(row.employeeName ?? "Без специалиста"), revenue: new Decimal(0), consumables: new Decimal(0), commission: new Decimal(0), appointments: 0 };
    employee.revenue = employee.revenue.plus(allocatedRevenue); employee.consumables = employee.consumables.plus(materialCost); employee.commission = employee.commission.plus(commission); employee.appointments += 1; employeeMap.set(employeeId, employee);
  }
  const money = (value: Decimal) => Number(value.toFixed(2));
  return {
    metrics: {
      grossRevenue: money(grossRevenue), refunds: money(refundAmount), netRevenue: money(netRevenue), payroll: money(payrollAmount), rent: money(rentAmount), utilities: money(utilityAmount), consumables: money(consumablesCost), otherExpenses: money(otherExpenses), grossProfit: money(grossProfit), operatingProfit: money(operatingProfit), margin: netRevenue.gt(0) ? Number(operatingProfit.div(netRevenue).mul(100).toFixed(1)) : 0, appointments: Number(counts?.appointments ?? 0), completed: Number(counts?.completed ?? 0), cancelled: Number(counts?.cancelled ?? 0), noShow: Number(counts?.noShow ?? 0), averageCheck: Number(counts?.completed ?? 0) ? money(netRevenue.div(Number(counts?.completed ?? 0))) : 0,
    },
    serviceRevenue: Array.from(serviceMap.values()).map((row) => ({ serviceId: row.serviceId, serviceName: row.serviceName, category: row.category, revenue: money(row.revenue), consumables: money(row.consumables), commission: money(row.commission), contributionMargin: Number(calculateContributionMargin({ revenue: row.revenue.toString(), consumables: row.consumables.toString(), commission: row.commission.toString() })), appointments: row.appointments })).sort((a, b) => b.revenue - a.revenue),
    employeeRevenue: Array.from(employeeMap.values()).map((row) => ({ employeeId: row.employeeId, employeeName: row.employeeName, revenue: money(row.revenue), consumables: money(row.consumables), commission: money(row.commission), contributionMargin: Number(calculateContributionMargin({ revenue: row.revenue.toString(), consumables: row.consumables.toString(), commission: row.commission.toString() })), appointments: row.appointments })).sort((a, b) => b.revenue - a.revenue),
    revenueByDay: (daily.results ?? []).map((row) => ({ day: row.day, amount: Number(row.amount ?? 0) })),
    expenseBreakdown: (expenseGroups.results ?? []).map((row) => ({ category: row.category, amount: Number(row.amount ?? 0) })),
  };
}

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "pnl.read")) return forbidden();
  const { from, to } = range(request);
  const current = await metricSnapshot(env.DB, from.toISOString(), to.toISOString(), request);
  const previousStart = new Date(from.getTime() - (to.getTime() - from.getTime()));
  const previousEnd = from;
  const previous = await metricSnapshot(env.DB, previousStart.toISOString(), previousEnd.toISOString(), request);
  const comparison = Object.fromEntries(Object.keys(current.metrics).map((key) => {
    const value = Number(current.metrics[key as keyof typeof current.metrics] ?? 0);
    const previousValue = Number(previous.metrics[key as keyof typeof previous.metrics] ?? 0);
    return [key, { value, previous: previousValue, change: Number((value - previousValue).toFixed(2)), changePercent: previousValue ? Number(((value - previousValue) / Math.abs(previousValue) * 100).toFixed(1)) : null }];
  }));
  return json({ ok: true, period: { from: from.toISOString(), to: to.toISOString() }, current, previous, comparison });
};
