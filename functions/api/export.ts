import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";

function csvValue(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(headers: string[], rows: Array<Record<string, unknown>>): string {
  return `\uFEFF${headers.join(",")}\n${rows.map((row) => headers.map((header) => csvValue(row[header])).join(",")).join("\n")}\n`;
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
  } else {
    return new Response("Unknown export type", { status: 400 });
  }
  return new Response(csv(headers, rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" } });
};
