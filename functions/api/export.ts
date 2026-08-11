import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { metricSnapshot } from "./pnl";

function csvValue(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(headers: string[], rows: Array<Record<string, unknown>>): string {
  return `\uFEFF${headers.join(",")}\n${rows.map((row) => headers.map((header) => csvValue(row[header])).join(",")).join("\n")}\n`;
}

function dateRange(from: string | undefined, to: string | undefined) {
  const now = new Date();
  const start = from ? new Date(`${from}T00:00:00.000Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = to ? new Date(`${to}T23:59:59.999Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from: Number.isNaN(start.getTime()) ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) : start, to: Number.isNaN(end.getTime()) ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) : end };
}

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "exports.read")) return forbidden();
  const params = new URL(request.url).searchParams;
  const type = params.get("type") ?? "clients";
  const from = params.get("from")?.trim();
  const to = params.get("to")?.trim();
  let headers: string[];
  let rows: Array<Record<string, unknown>>;
  let filename: string;
  if (type === "clients") {
    headers = ["fullName", "phone", "email", "visits", "totalPaid", "lastVisit", "nextVisit", "status"];
    const result = await env.DB.prepare(`SELECT c.full_name AS fullName, c.phone, c.email, COUNT(CASE WHEN a.status = 'COMPLETED' THEN 1 END) AS visits, COALESCE((SELECT SUM(p.amount) FROM payments p INNER JOIN appointments pa ON pa.id = p.appointment_id WHERE pa.client_id = c.id AND p.payment_status = 'POSTED'), 0) - COALESCE((SELECT SUM(pa2.amount) FROM payment_adjustments pa2 INNER JOIN payments rp ON rp.id = pa2.payment_id INNER JOIN appointments ra ON ra.id = rp.appointment_id WHERE ra.client_id = c.id), 0) AS totalPaid, MAX(CASE WHEN a.status = 'COMPLETED' THEN a.starts_at END) AS lastVisit, MIN(CASE WHEN a.starts_at >= CURRENT_TIMESTAMP AND a.status NOT IN ('CANCELLED', 'NO_SHOW', 'COMPLETED') THEN a.starts_at END) AS nextVisit, CASE WHEN c.is_active = 1 THEN 'active' ELSE 'archived' END AS status FROM clients c LEFT JOIN appointments a ON a.client_id = c.id GROUP BY c.id ORDER BY c.full_name`).all();
    rows = (result.results ?? []) as Array<Record<string, unknown>>;
    filename = "clients.csv";
  } else if (type === "appointments") {
    headers = ["startsAt", "endsAt", "clientName", "clientPhone", "employeeName", "branchName", "serviceName", "status", "totalAmount", "paidAmount", "refundedAmount", "balance"];
    const filters = ["1 = 1"]; const bindings: string[] = [];
    if (from) { filters.push("a.starts_at >= ?"); bindings.push(`${from}T00:00:00.000Z`); }
    if (to) { filters.push("a.starts_at <= ?"); bindings.push(`${to}T23:59:59.999Z`); }
    const result = await env.DB.prepare(`SELECT a.starts_at AS startsAt, a.ends_at AS endsAt, c.full_name AS clientName, c.phone AS clientPhone, e.full_name AS employeeName, b.name AS branchName, (SELECT group_concat(s.name, ', ') FROM appointment_services aps INNER JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id) AS serviceName, a.status, a.total_amount AS totalAmount, COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.appointment_id = a.id AND p.payment_status = 'POSTED'), 0) AS paidAmount, COALESCE((SELECT SUM(pa.amount) FROM payment_adjustments pa INNER JOIN payments rp ON rp.id = pa.payment_id WHERE rp.appointment_id = a.id), 0) AS refundedAmount, a.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.appointment_id = a.id AND p.payment_status = 'POSTED'), 0) + COALESCE((SELECT SUM(pa.amount) FROM payment_adjustments pa INNER JOIN payments rp ON rp.id = pa.payment_id WHERE rp.appointment_id = a.id), 0) AS balance FROM appointments a INNER JOIN clients c ON c.id = a.client_id LEFT JOIN employees e ON e.id = a.employee_id LEFT JOIN branches b ON b.id = a.branch_id WHERE ${filters.join(" AND ")} ORDER BY a.starts_at`).bind(...bindings).all();
    rows = (result.results ?? []) as Array<Record<string, unknown>>;
    filename = "appointments.csv";
  } else if (type === "payments") {
    headers = ["paidAt", "clientName", "appointmentId", "amount", "refundedAmount", "netAmount", "method", "status", "note"];
    const paymentFilters = ["1 = 1"]; const paymentBindings: string[] = [];
    if (from) { paymentFilters.push("p.paid_at >= ?"); paymentBindings.push(`${from}T00:00:00.000Z`); }
    if (to) { paymentFilters.push("p.paid_at <= ?"); paymentBindings.push(`${to}T23:59:59.999Z`); }
    const result = await env.DB.prepare(`SELECT p.paid_at AS paidAt, c.full_name AS clientName, p.appointment_id AS appointmentId, p.amount, COALESCE((SELECT SUM(pa.amount) FROM payment_adjustments pa WHERE pa.payment_id = p.id), 0) AS refundedAmount, p.amount - COALESCE((SELECT SUM(pa.amount) FROM payment_adjustments pa WHERE pa.payment_id = p.id), 0) AS netAmount, p.method, p.payment_status AS status, p.note FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id INNER JOIN clients c ON c.id = a.client_id WHERE ${paymentFilters.join(" AND ")} ORDER BY p.paid_at DESC LIMIT 5000`).bind(...paymentBindings).all();
    rows = (result.results ?? []) as Array<Record<string, unknown>>;
    filename = "payments.csv";
  } else if (type === "expenses") {
    headers = ["occurredAt", "title", "category", "branchName", "amount", "status", "description"];
    const expenseFilters = ["x.direction = 'EXPENSE'", "x.kind <> 'SALARY'", "x.status <> 'VOIDED'"]; const expenseBindings: string[] = [];
    if (from) { expenseFilters.push("x.occurred_at >= ?"); expenseBindings.push(`${from}T00:00:00.000Z`); }
    if (to) { expenseFilters.push("x.occurred_at <= ?"); expenseBindings.push(`${to}T23:59:59.999Z`); }
    const result = await env.DB.prepare(`SELECT x.occurred_at AS occurredAt, CASE x.kind WHEN 'RENT' THEN 'Аренда' WHEN 'UTILITIES' THEN 'Коммунальные услуги' WHEN 'SALARY' THEN 'Зарплата' ELSE COALESCE(x.description, 'Расход') END AS title, x.category, b.name AS branchName, x.amount, x.status, x.description FROM financial_transactions x LEFT JOIN branches b ON b.id = x.branch_id WHERE ${expenseFilters.join(" AND ")} ORDER BY x.occurred_at DESC LIMIT 5000`).bind(...expenseBindings).all();
    rows = (result.results ?? []) as Array<Record<string, unknown>>;
    filename = "expenses.csv";
  } else if (type === "payroll") {
    headers = ["periodStart", "periodEnd", "status", "employeeName", "fixedAmount", "revenueBase", "revenueAmount", "bonusAmount", "deductionAmount", "advanceAmount", "totalAmount"];
    const payrollFilters = ["1 = 1"]; const payrollBindings: string[] = [];
    if (from) { payrollFilters.push("p.period_start >= ?"); payrollBindings.push(`${from}T00:00:00.000Z`); }
    if (to) { payrollFilters.push("p.period_start <= ?"); payrollBindings.push(`${to}T23:59:59.999Z`); }
    const result = await env.DB.prepare(`SELECT p.period_start AS periodStart, p.period_end AS periodEnd, p.status, e.full_name AS employeeName, l.fixed_amount AS fixedAmount, l.revenue_base AS revenueBase, l.revenue_amount AS revenueAmount, l.bonus_amount AS bonusAmount, l.deduction_amount AS deductionAmount, l.advance_amount AS advanceAmount, l.total_amount AS totalAmount FROM payroll_lines l INNER JOIN payroll_periods p ON p.id = l.period_id INNER JOIN employees e ON e.id = l.employee_id WHERE ${payrollFilters.join(" AND ")} ORDER BY p.period_start DESC, e.full_name LIMIT 5000`).bind(...payrollBindings).all();
    rows = (result.results ?? []) as Array<Record<string, unknown>>;
    filename = "payroll.csv";
  } else if (type === "inventory") {
    headers = ["name", "sku", "category", "unit", "branchName", "supplierName", "currentStock", "minStock", "optimalStock", "purchasePrice", "active"];
    const result = await env.DB.prepare(`SELECT p.name, p.sku, pc.name AS category, p.unit, b.name AS branchName, s.name AS supplierName,
      COALESCE((SELECT SUM(CASE WHEN sm.direction = 'IN' THEN sm.quantity ELSE -sm.quantity END) FROM stock_movements sm WHERE sm.product_id = p.id), 0) AS currentStock,
      p.min_stock AS minStock, p.optimal_stock AS optimalStock, p.purchase_price AS purchasePrice, CASE WHEN p.active = 1 THEN 'active' ELSE 'archived' END AS active
      FROM products p LEFT JOIN product_categories pc ON pc.id = p.category_id LEFT JOIN branches b ON b.id = p.branch_id LEFT JOIN suppliers s ON s.id = p.supplier_id ORDER BY p.name`).all();
    rows = (result.results ?? []) as Array<Record<string, unknown>>;
    filename = "inventory.csv";
  } else if (type === "stock-movements") {
    headers = ["occurredAt", "productName", "sku", "movementType", "direction", "quantity", "unitPrice", "totalCost", "branchName", "source", "comment"];
    const movementFilters = ["1 = 1"]; const movementBindings: string[] = [];
    if (from) { movementFilters.push("sm.occurred_at >= ?"); movementBindings.push(`${from}T00:00:00.000Z`); }
    if (to) { movementFilters.push("sm.occurred_at <= ?"); movementBindings.push(`${to}T23:59:59.999Z`); }
    const result = await env.DB.prepare(`SELECT sm.occurred_at AS occurredAt, p.name AS productName, p.sku, sm.movement_type AS movementType, sm.direction, sm.quantity, sm.unit_price AS unitPrice, sm.total_cost AS totalCost, b.name AS branchName, sm.source, sm.comment FROM stock_movements sm INNER JOIN products p ON p.id = sm.product_id LEFT JOIN branches b ON b.id = sm.branch_id WHERE ${movementFilters.join(" AND ")} ORDER BY sm.occurred_at DESC LIMIT 10000`).bind(...movementBindings).all();
    rows = (result.results ?? []) as Array<Record<string, unknown>>;
    filename = "stock-movements.csv";
  } else if (type === "purchases") {
    headers = ["purchaseId", "orderedAt", "receivedAt", "supplierName", "branchName", "status", "productName", "quantity", "receivedQuantity", "unitPrice", "totalAmount", "paymentMethod", "paid"];
    const result = await env.DB.prepare(`SELECT pu.id AS purchaseId, pu.ordered_at AS orderedAt, pu.received_at AS receivedAt, s.name AS supplierName, b.name AS branchName, pu.status, p.name AS productName, pi.quantity, pi.received_quantity AS receivedQuantity, pi.unit_price AS unitPrice, pu.total_amount AS totalAmount, pu.payment_method AS paymentMethod, CASE WHEN pu.paid = 1 THEN 'yes' ELSE 'no' END AS paid FROM purchases pu INNER JOIN purchase_items pi ON pi.purchase_id = pu.id INNER JOIN products p ON p.id = pi.product_id LEFT JOIN suppliers s ON s.id = pu.supplier_id LEFT JOIN branches b ON b.id = pu.branch_id ORDER BY pu.ordered_at DESC LIMIT 10000`).all();
    rows = (result.results ?? []) as Array<Record<string, unknown>>;
    filename = "purchases.csv";
  } else if (type === "tasks") {
    headers = ["title", "description", "assigneeName", "clientName", "branchName", "dueDate", "priority", "status", "completedAt", "createdAt"];
    const result = await env.DB.prepare("SELECT t.title, t.description, u.name AS assigneeName, c.full_name AS clientName, b.name AS branchName, t.due_date AS dueDate, t.priority, t.status, t.completed_at AS completedAt, t.created_at AS createdAt FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN branches b ON b.id = t.branch_id ORDER BY t.due_date DESC LIMIT 10000").all();
    rows = (result.results ?? []) as Array<Record<string, unknown>>;
    filename = "tasks.csv";
  } else if (type === "pnl" || type === "kpi") {
    const range = dateRange(from, to);
    const snapshot = await metricSnapshot(env.DB, range.from.toISOString(), range.to.toISOString(), request);
    if (type === "pnl") {
      headers = ["metric", "value"];
      rows = Object.entries(snapshot.metrics).map(([metric, value]) => ({ metric, value }));
      filename = "pnl.csv";
    } else {
      headers = ["employeeId", "employeeName", "appointments", "revenue", "consumables", "commission", "contributionMargin"];
      rows = snapshot.employeeRevenue as Array<Record<string, unknown>>;
      filename = "kpi.csv";
    }
  } else {
    return new Response("Unknown export type", { status: 400 });
  }
  return new Response(csv(headers, rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" } });
};
