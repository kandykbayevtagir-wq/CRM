import Decimal from "decimal.js";
import { calculateContributionMargin, calculateOperatingProfit } from "../../src/lib/finance/business";

import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import { inRange, localDayExpression, organizationTimezone, periodRange } from "../_lib/dates";
import type { CrmEnv } from "../_lib/env";
import { json } from "../_lib/http";

function scope(request: Request, alias = "a") {
  const params = new URL(request.url).searchParams;
  const conditions: string[] = [];
  const bindings: string[] = [];
  const branchId = params.get("branchId")?.trim() ?? "";
  const employeeId = params.get("employeeId")?.trim() ?? "";
  const serviceId = params.get("serviceId")?.trim() ?? "";
  const category = params.get("category")?.trim() ?? "";
  if (branchId) { conditions.push(`${alias}.branch_id = ?`); bindings.push(branchId); }
  if (employeeId) { conditions.push(`${alias}.employee_id = ?`); bindings.push(employeeId); }
  if (serviceId) { conditions.push(`EXISTS (SELECT 1 FROM appointment_services sf WHERE sf.appointment_id = ${alias}.id AND sf.service_id = ?)`); bindings.push(serviceId); }
  if (category) { conditions.push(`EXISTS (SELECT 1 FROM appointment_services sc INNER JOIN services svc ON svc.id = sc.service_id WHERE sc.appointment_id = ${alias}.id AND svc.category = ?)`); bindings.push(category); }
  const where = conditions.length ? ` AND ${conditions.join(" AND ")}` : "";
  return { where, bindings, branchId, employeeId, serviceId, category };
}

export async function metricSnapshot(db: D1Database, from: string, to: string, request: Request, timezone = "Asia/Almaty") {
  const filter = scope(request);
  const branchWhere = filter.branchId ? " AND x.branch_id = ?" : "";
  const branchBinding = filter.branchId ? [filter.branchId] : [];
  const payrollConditions = [inRange("pp.period_start")];
  const payrollBindings: string[] = [from, to];
  if (filter.employeeId) { payrollConditions.push("l.employee_id = ?"); payrollBindings.push(filter.employeeId); }
  if (filter.branchId) { payrollConditions.push("EXISTS (SELECT 1 FROM employee_branches payroll_eb WHERE payroll_eb.employee_id = l.employee_id AND payroll_eb.branch_id = ?)"); payrollBindings.push(filter.branchId); }
  const [revenue, refunds, consumables, expenses, payroll, counts, lines, daily, expenseGroups, rent, utilities] = await Promise.all([
    db.prepare(`SELECT COALESCE(SUM(p.amount), 0) AS value FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id WHERE a.status = 'COMPLETED' AND p.payment_status = 'POSTED' AND ${inRange("p.paid_at")}${filter.where}`).bind(from, to, ...filter.bindings).first<{ value: number }>(),
    db.prepare(`SELECT COALESCE(SUM(pa.amount), 0) AS value FROM payment_adjustments pa INNER JOIN payments p ON p.id = pa.payment_id INNER JOIN appointments a ON a.id = p.appointment_id WHERE a.status = 'COMPLETED' AND ${inRange("pa.occurred_at")}${filter.where}`).bind(from, to, ...filter.bindings).first<{ value: number }>(),
    db.prepare(`SELECT COALESCE(SUM(ic.total_cost), 0) AS value FROM inventory_consumptions ic INNER JOIN appointments a ON a.id = ic.appointment_id WHERE a.status = 'COMPLETED' AND ${inRange("a.starts_at")}${filter.where}`).bind(from, to, ...filter.bindings).first<{ value: number }>(),
    db.prepare(`SELECT COALESCE(SUM(x.amount), 0) AS value FROM financial_transactions x WHERE x.status = 'POSTED' AND x.direction = 'EXPENSE' AND x.kind NOT IN ('SALARY', 'RENT', 'UTILITIES') AND ${inRange("x.occurred_at")}${branchWhere}`).bind(from, to, ...branchBinding).first<{ value: number }>(),
    db.prepare(`SELECT COALESCE(SUM(l.total_amount), 0) AS value FROM payroll_lines l INNER JOIN payroll_periods pp ON pp.id = l.period_id WHERE pp.status IN ('CALCULATED', 'CLOSED') AND ${payrollConditions.join(" AND ")}`).bind(...payrollBindings).first<{ value: number }>(),
    db.prepare(`SELECT COUNT(*) AS appointments, SUM(CASE WHEN a.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed, SUM(CASE WHEN a.status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled, SUM(CASE WHEN a.status = 'NO_SHOW' THEN 1 ELSE 0 END) AS noShow FROM appointments a WHERE ${inRange("a.starts_at")}${filter.where}`).bind(from, to, ...filter.bindings).first<{ appointments: number; completed: number; cancelled: number; noShow: number }>(),
    db.prepare(`SELECT a.id, a.starts_at AS startsAt, a.employee_id AS employeeId, e.full_name AS employeeName, a.branch_id AS branchId, s.id AS serviceId, s.name AS serviceName, s.category, aps.price, aps.quantity, a.total_amount AS appointmentAmount,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.appointment_id = a.id AND p.payment_status = 'POSTED' AND ${inRange("p.paid_at")}), 0) AS paidAmount,
      COALESCE((SELECT SUM(pa.amount) FROM payment_adjustments pa INNER JOIN payments rp ON rp.id = pa.payment_id WHERE rp.appointment_id = a.id AND ${inRange("pa.occurred_at")}), 0) AS refundedAmount,
      COALESCE((SELECT SUM(ic.total_cost) FROM inventory_consumptions ic WHERE ic.appointment_id = a.id AND ic.service_id = aps.service_id), 0) AS consumablesCost,
      COALESCE((SELECT commission_percent FROM employee_services es WHERE es.employee_id = a.employee_id AND es.service_id = aps.service_id AND es.active = 1 AND (es.branch_id = a.branch_id OR es.branch_id IS NULL) ORDER BY es.branch_id IS NULL LIMIT 1), e.revenue_percent) AS commissionPercent
      FROM appointments a INNER JOIN appointment_services aps ON aps.appointment_id = a.id INNER JOIN services s ON s.id = aps.service_id LEFT JOIN employees e ON e.id = a.employee_id WHERE a.status = 'COMPLETED' AND ${inRange("a.starts_at")}${filter.where}`).bind(from, to, from, to, from, to, ...filter.bindings).all<Record<string, unknown>>(),
    db.prepare(`SELECT day, COALESCE(SUM(amount), 0) AS amount FROM (
      SELECT ${localDayExpression("p.paid_at", from, timezone)} AS day, p.amount AS amount FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id WHERE a.status = 'COMPLETED' AND p.payment_status = 'POSTED' AND ${inRange("p.paid_at")}${filter.where}
      UNION ALL
      SELECT ${localDayExpression("pa.occurred_at", from, timezone)} AS day, -pa.amount AS amount FROM payment_adjustments pa INNER JOIN payments rp ON rp.id = pa.payment_id INNER JOIN appointments a ON a.id = rp.appointment_id WHERE a.status = 'COMPLETED' AND ${inRange("pa.occurred_at")}${filter.where}
    ) GROUP BY day ORDER BY day`).bind(from, to, ...filter.bindings, from, to, ...filter.bindings).all<{ day: string; amount: number }>(),
    db.prepare(`SELECT x.kind AS category, COALESCE(SUM(x.amount), 0) AS amount FROM financial_transactions x WHERE x.status = 'POSTED' AND x.direction = 'EXPENSE' AND ${inRange("x.occurred_at")}${branchWhere} GROUP BY x.kind ORDER BY amount DESC`).bind(from, to, ...branchBinding).all<{ category: string; amount: number }>(),
    db.prepare(`SELECT COALESCE(SUM(x.amount), 0) AS value FROM financial_transactions x WHERE x.status = 'POSTED' AND x.direction = 'EXPENSE' AND x.kind = 'RENT' AND ${inRange("x.occurred_at")}${branchWhere}`).bind(from, to, ...branchBinding).first<{ value: number }>(),
    db.prepare(`SELECT COALESCE(SUM(x.amount), 0) AS value FROM financial_transactions x WHERE x.status = 'POSTED' AND x.direction = 'EXPENSE' AND x.kind = 'UTILITIES' AND ${inRange("x.occurred_at")}${branchWhere}`).bind(from, to, ...branchBinding).first<{ value: number }>(),
  ]);
  const grossRevenue = new Decimal(revenue?.value ?? 0);
  const refundAmount = new Decimal(refunds?.value ?? 0);
  const netRevenue = grossRevenue.minus(refundAmount);
  const consumablesCost = new Decimal(consumables?.value ?? 0);
  const payrollAmount = new Decimal(payroll?.value ?? 0);
  const otherExpenses = new Decimal(expenses?.value ?? 0);
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
  const params = new URL(request.url).searchParams;
  const timezone = await organizationTimezone(env.DB);
  const { from, to } = periodRange(params.get("from"), params.get("to"), timezone);
  const current = await metricSnapshot(env.DB, from, to, request, timezone);
  const length = Date.parse(to) - Date.parse(from);
  const previousStart = new Date(Date.parse(from) - length).toISOString();
  const previous = await metricSnapshot(env.DB, previousStart, from, request, timezone);
  const comparison = Object.fromEntries(Object.keys(current.metrics).map((key) => {
    const value = Number(current.metrics[key as keyof typeof current.metrics] ?? 0);
    const previousValue = Number(previous.metrics[key as keyof typeof previous.metrics] ?? 0);
    return [key, { value, previous: previousValue, change: Number((value - previousValue).toFixed(2)), changePercent: previousValue ? Number(((value - previousValue) / Math.abs(previousValue) * 100).toFixed(1)) : null }];
  }));
  return json({ ok: true, period: { from, to }, current, previous, comparison });
};
