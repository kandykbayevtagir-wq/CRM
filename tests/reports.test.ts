import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { testDatabase, seed, seedRoles, seedVisit, seedPayment, requestContext } from "./d1";
import type { CrmEnv } from "../functions/_lib/env";
import { onRequestGet as pnl } from "../functions/api/pnl";
import { onRequestGet as kpi } from "../functions/api/kpi";
import { onRequestGet as reports } from "../functions/api/reports";
import { onRequestGet as dashboard } from "../functions/api/dashboard";
import { onRequestGet as exportCsv } from "../functions/api/export";
import { onRequestGet as listAppointments, onRequestPost as createAppointment } from "../functions/api/appointments";
import { onRequestPatch as updateVisit } from "../functions/api/appointments/[id]";
import { onRequestPost as openPayroll } from "../functions/api/payroll";
import { onRequestPost as book } from "../functions/api/client/appointments";
import { onRequestGet as listGoals, onRequestPost as createGoal } from "../functions/api/goals";
import { calculatePayrollPeriod, closePayrollPeriod } from "../functions/_lib/payroll";
import { getSessionUser } from "../functions/_lib/auth";
import { periodRange, zonedInstant, normalizeIso } from "../functions/_lib/dates";

let db: D1Database;
let sqlite: DatabaseSync;
beforeEach(() => { ({ db, sqlite } = testDatabase()); seed(sqlite); seedRoles(sqlite); });
afterEach(() => { vi.unstubAllGlobals(); sqlite.close(); });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function call(handler: PagesFunction<CrmEnv>, path: string, method = "GET", body?: Record<string, unknown>, userId = "owner", params: Record<string, string> = {}) {
  const { context } = await requestContext(db, path, method, body, userId, params);
  const response = await handler(context) as Response;
  const text = await response.text();
  let json: Json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, body: json as Json, text };
}
async function actor(userId = "owner") {
  const { context } = await requestContext(db, "/", "GET", undefined, userId);
  const user = await getSessionUser(context.request, db);
  if (!user) throw new Error("no user");
  return user;
}

/** January 2030 in Asia/Almaty: a visit paid at 18:00 local on the 31st (13:00Z) and a refund. */
function seedJanuary() {
  seedVisit(sqlite, "jan-last", "COMPLETED", "2030-01-31T08:00:00Z");
  seedPayment(sqlite, "jan-last", 10000, "2030-01-31T13:00:00.000Z");
  // 2030-01-31T20:00Z is already 1 February 01:00 in Almaty, so it belongs to February.
  seedVisit(sqlite, "feb-first", "COMPLETED", "2030-01-31T19:30:00Z");
  seedPayment(sqlite, "feb-first", 7000, "2030-01-31T20:00:00.000Z");
  // Legacy SQLite timestamp (UTC) in the middle of January.
  seedVisit(sqlite, "jan-legacy", "COMPLETED", "2030-01-15 06:00:00");
  seedPayment(sqlite, "jan-legacy", 5000, "2030-01-15 07:00:00");
  sqlite.prepare("INSERT INTO payment_adjustments(id,payment_id,appointment_id,kind,amount,reason,occurred_at,created_by) VALUES('refund','payment-jan-legacy','jan-legacy','REFUND',1000,'Возврат','2030-01-16T05:00:00.000Z','owner')").run();
  sqlite.prepare("INSERT INTO financial_transactions(id,direction,kind,category,amount,status,occurred_at,branch_id,created_by) VALUES('rent-jan','EXPENSE','RENT','RENT',3000,'POSTED','2030-01-31T18:30:00.000Z','branch','owner')").run();
}

describe("reporting periods", () => {
  it("treats date-only bounds as inclusive local days of the centre", () => {
    const range = periodRange("2030-01-01", "2030-01-31", "Asia/Almaty");
    expect(range.from).toBe("2029-12-31T19:00:00.000Z");
    expect(range.to).toBe("2030-01-31T19:00:00.000Z");
    const inverted = periodRange("2030-01-31", "2030-01-01", "Asia/Almaty");
    expect(Date.parse(inverted.to)).toBeGreaterThan(Date.parse(inverted.from));
    const garbage = periodRange("not-a-date", "2030-13-45", "Asia/Almaty", new Date("2030-06-15T12:00:00Z"));
    expect(garbage.from).toBe("2030-05-31T19:00:00.000Z");
    expect(zonedInstant("2030-01-08T10:00", "Asia/Almaty")).toBe("2030-01-08T05:00:00.000Z");
    expect(zonedInstant("2030-01-08", "Asia/Almaty")).toBe("2030-01-07T19:00:00.000Z");
    expect(normalizeIso("2030-01-15 06:00:00")).toBe("2030-01-15T06:00:00.000Z");
    expect(normalizeIso("garbage")).toBe("");
  });
  it("includes the last day of the month and legacy timestamps in P&L", async () => {
    seedJanuary();
    const result = await call(pnl, "/api/pnl?from=2030-01-01&to=2030-01-31");
    expect(result.status).toBe(200);
    const metrics = result.body.current.metrics;
    expect(metrics.grossRevenue).toBe(15000);
    expect(metrics.refunds).toBe(1000);
    expect(metrics.netRevenue).toBe(14000);
    expect(metrics.rent).toBe(3000);
    expect(result.body.current.revenueByDay.map((row: Json) => row.day)).toEqual(expect.arrayContaining(["2030-01-15", "2030-01-31"]));
    expect(result.body.current.revenueByDay.some((row: Json) => row.day === "2030-02-01")).toBe(false);
    expect(result.body.current.employeeRevenue[0].employeeName).toBe("Специалист");
    expect(Number(result.body.current.serviceRevenue[0].appointments)).toBe(2);
    const february = await call(pnl, "/api/pnl?from=2030-02-01&to=2030-02-28");
    expect(february.body.current.metrics.grossRevenue).toBe(7000);
    expect(february.body.comparison.netRevenue.previous).toBe(14000);
  });
  it("falls back to the current month instead of failing on invalid dates", async () => {
    for (const path of ["/api/pnl?from=abc&to=xyz", "/api/kpi?from=2030-99-99", "/api/reports?from=&to=garbage", "/api/goals?from=nope"]) {
      const handler = path.startsWith("/api/pnl") ? pnl : path.startsWith("/api/kpi") ? kpi : path.startsWith("/api/reports") ? reports : listGoals;
      const result = await call(handler, path, "GET", undefined, "owner");
      expect(result.status, path).toBe(200);
    }
    expect((await call(createGoal, "/api/goals", "POST", { periodStart: "2030-02-01", periodEnd: "2030-01-01", metric: "REVENUE", targetValue: 100 })).status).toBe(400);
    expect((await call(createGoal, "/api/goals", "POST", { periodStart: "2030-01-01", periodEnd: "2030-01-31", metric: "REVENUE", targetValue: 0 })).status).toBe(400);
    const goal = await call(createGoal, "/api/goals", "POST", { periodStart: "2030-01-01", periodEnd: "2030-01-31", metric: "REVENUE", targetValue: 20000 });
    expect(goal.status).toBe(201);
    expect(sqlite.prepare("SELECT period_start AS s, period_end AS e FROM goals").get()).toEqual({ s: "2029-12-31T19:00:00.000Z", e: "2030-01-31T19:00:00.000Z" });
  });
  it("agrees between KPI, reports, dashboard month and CSV export", async () => {
    seedJanuary();
    const kpiResult = await call(kpi, "/api/kpi?from=2030-01-01&to=2030-01-31");
    expect(kpiResult.status).toBe(200);
    const row = kpiResult.body.items.find((item: Json) => item.employeeId === "employee");
    expect(row.completedAppointments).toBe(2);
    expect(row.revenue).toBe(14000);
    const report = await call(reports, "/api/reports?from=2030-01-01&to=2030-01-31");
    expect(report.status).toBe(200);
    expect(report.body.metrics.grossRevenue).toBe(15000);
    expect(report.body.metrics.revenue).toBe(14000);
    expect(report.body.metrics.completed).toBe(2);
    expect(report.body.period).toEqual({ from: "2029-12-31T19:00:00.000Z", to: "2030-01-31T19:00:00.000Z" });
    const csv = await call(exportCsv, "/api/export?type=payments&from=2030-01-01&to=2030-01-31");
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("2030-01-31T13:00:00.000Z");
    expect(csv.text).toContain("2030-01-15T07:00:00.000Z");
    expect(csv.text).not.toContain("2030-01-31T20:00:00.000Z");
    const appointmentsCsv = await call(exportCsv, "/api/export?type=appointments&from=2030-01-15&to=2030-01-15");
    expect(appointmentsCsv.text.trim().split("\n")).toHaveLength(2);
    expect(appointmentsCsv.text).toContain("2030-01-15T06:00:00.000Z");
  });
  it("shows legacy-format upcoming appointments on the dashboard in canonical ISO", async () => {
    seedVisit(sqlite, "legacy-future", "CONFIRMED", "2031-03-03 05:00:00");
    const result = await call(dashboard, "/api/dashboard");
    expect(result.status).toBe(200);
    const upcoming = result.body.upcoming.find((item: Json) => item.id === "legacy-future");
    expect(upcoming.startsAt).toBe("2031-03-03T05:00:00.000Z");
  });
});

describe("appointments and timezone handling", () => {
  it("filters a local day correctly for legacy and ISO rows and returns ISO timestamps", async () => {
    seedVisit(sqlite, "legacy", "SCHEDULED", "2030-01-07 04:00:00");
    seedVisit(sqlite, "iso", "SCHEDULED", "2030-01-07T13:00:00Z");
    // 2030-01-07T20:00Z is already 8 January in Almaty.
    seedVisit(sqlite, "next-day", "SCHEDULED", "2030-01-07T20:00:00Z", "other-employee");
    const result = await call(listAppointments, "/api/appointments?date=2030-01-07");
    expect(result.status).toBe(200);
    const ids = result.body.items.map((item: Json) => item.id).sort();
    expect(ids).toEqual(["iso", "legacy"]);
    const legacy = result.body.items.find((item: Json) => item.id === "legacy");
    expect(legacy.startsAt).toBe("2030-01-07T04:00:00.000Z");
    expect(legacy.revision).toBe(0);
    expect(legacy.clientId).toBe("client");
  });
  it("interprets a zone-less datetime-local value in the centre's timezone", async () => {
    const result = await call(createAppointment, "/api/appointments", "POST", { startsAt: "2030-01-08T10:00", branchId: "branch", employeeId: "employee", clientId: "client", serviceIds: ["service"] });
    expect(result.status).toBe(201);
    expect(result.body.startsAt).toBe("2030-01-08T05:00:00.000Z");
    expect(sqlite.prepare("SELECT ends_at AS e FROM appointments WHERE id = ?").get(result.body.id)?.e).toBe("2030-01-08T06:00:00.000Z");
  });
  it("treats a status change on a legacy-format row as not moved", async () => {
    seedVisit(sqlite, "legacy", "SCHEDULED", "2030-01-07 04:00:00");
    const result = await call(updateVisit, "/api/appointments/legacy", "PATCH", { status: "CONFIRMED", startsAt: "2030-01-07T04:00:00.000Z", employeeId: "employee", branchId: "branch", revision: 0 }, "owner", { id: "legacy" });
    expect(result.status).toBe(200);
    expect(sqlite.prepare("SELECT status, starts_at AS s FROM appointments WHERE id = 'legacy'").get()).toEqual({ status: "CONFIRMED", s: "2030-01-07 04:00:00" });
    expect(Number(sqlite.prepare("SELECT COUNT(*) AS value FROM message_outbox WHERE template_key = 'BOOKING_CHANGED'").get()?.value)).toBe(0);
  });
  it("keeps the agreed price and services when a client reschedules", async () => {
    seedVisit(sqlite, "discounted", "SCHEDULED", "2030-01-07T04:00:00Z");
    sqlite.exec("UPDATE appointments SET total_amount = 7500 WHERE id = 'discounted'; UPDATE appointment_services SET price = 7500 WHERE appointment_id = 'discounted'");
    const moved = await call(book, "/api/client/appointments", "POST", { appointmentId: "discounted", startsAt: "2030-01-07T06:00:00.000Z", serviceId: "service", branchId: "branch", employeeId: "employee", idempotencyKey: "move-1" }, "user");
    expect(moved.status).toBe(200);
    expect(moved.body.changed).toBe(true);
    const row = sqlite.prepare("SELECT total_amount AS total, starts_at AS s, status FROM appointments WHERE id = 'discounted'").get() as Json;
    expect(row.total).toBe(7500);
    expect(row.s).toBe("2030-01-07T06:00:00.000Z");
    expect(Number(sqlite.prepare("SELECT COUNT(*) AS value FROM appointment_services WHERE appointment_id = 'discounted'").get()?.value)).toBe(1);
    sqlite.exec("INSERT INTO services(id,name,price,duration_minutes,is_active) VALUES('second','Вторая',3000,30,1); INSERT INTO appointment_services(appointment_id,service_id,price,duration_minutes,quantity) VALUES('discounted','second',3000,30,1)");
    const multi = await call(book, "/api/client/appointments", "POST", { appointmentId: "discounted", startsAt: "2030-01-07T08:00:00.000Z", serviceId: "service", branchId: "branch", employeeId: "employee", idempotencyKey: "move-2" }, "user");
    expect(multi.status).toBe(400);
    expect(sqlite.prepare("SELECT starts_at AS s FROM appointments WHERE id = 'discounted'").get()?.s).toBe("2030-01-07T06:00:00.000Z");
  });
});

describe("payroll periods", () => {
  it("opens periods on local day boundaries and rejects overlaps", async () => {
    const first = await call(openPayroll, "/api/payroll", "POST", { periodStart: "2030-01-01", periodEnd: "2030-01-31" });
    expect(first.status).toBe(201);
    expect(sqlite.prepare("SELECT period_start AS s, period_end AS e FROM payroll_periods WHERE id = ?").get(first.body.id)).toEqual({ s: "2029-12-31T19:00:00.000Z", e: "2030-01-31T19:00:00.000Z" });
    expect((await call(openPayroll, "/api/payroll", "POST", { periodStart: "2030-01-15", periodEnd: "2030-02-15" })).status).toBe(409);
    expect((await call(openPayroll, "/api/payroll", "POST", { periodStart: "2030-02-01", periodEnd: "2030-01-01" })).status).toBe(400);
    expect((await call(openPayroll, "/api/payroll", "POST", { periodStart: "2030-02-01", periodEnd: "2031-03-01" })).status).toBe(400);
    expect((await call(openPayroll, "/api/payroll", "POST", { periodStart: "2030-02-01", periodEnd: "2030-02-28" })).status).toBe(201);
  });
  it("sums lines with decimals, includes the last local day and refuses a negative close", async () => {
    seedJanuary();
    sqlite.exec("UPDATE employees SET fixed_salary = 0.1, revenue_percent = 10 WHERE id = 'employee'; UPDATE employees SET fixed_salary = 0.2, revenue_percent = 0 WHERE id = 'other-employee'");
    const period = await call(openPayroll, "/api/payroll", "POST", { periodStart: "2030-01-01", periodEnd: "2030-01-31" });
    const owner = await actor();
    const calculated = await calculatePayrollPeriod(db, period.body.id, owner);
    const line = calculated.lines.find((item) => item.employeeId === "employee");
    // 14 000 net revenue × 10% + 0.1 fixed; the February payment must not leak in.
    expect(Number(line?.revenueBase)).toBe(14000);
    expect(calculated.totalAmount).toBe(1400.3);
    sqlite.prepare("INSERT INTO payroll_adjustments(id,employee_id,period_id,kind,amount,reason) VALUES('adv','employee',?,'ADVANCE',5000,'Аванс')").run(period.body.id);
    const negative = await calculatePayrollPeriod(db, period.body.id, owner);
    expect(negative.totalAmount).toBeLessThan(0);
    await expect(closePayrollPeriod(db, period.body.id, owner)).rejects.toMatchObject({ status: 409 });
    expect(sqlite.prepare("SELECT status FROM payroll_periods WHERE id = ?").get(period.body.id)?.status).toBe("CALCULATED");
    sqlite.exec("DELETE FROM payroll_adjustments");
    await calculatePayrollPeriod(db, period.body.id, owner);
    const closed = await closePayrollPeriod(db, period.body.id, owner);
    expect(closed.status).toBe("CLOSED");
    const ledger = sqlite.prepare("SELECT amount, occurred_at AS at FROM financial_transactions WHERE kind = 'SALARY'").get() as Json;
    expect(ledger.amount).toBe(1400.3);
    expect(ledger.at).toBe("2030-01-31T18:59:59.000Z");
    const report = await call(reports, "/api/reports?from=2030-01-01&to=2030-01-31");
    expect(report.body.metrics.payroll).toBe(1400.3);
    const pnlResult = await call(pnl, "/api/pnl?from=2030-01-01&to=2030-01-31");
    expect(pnlResult.body.current.metrics.payroll).toBe(1400.3);
  });
});
