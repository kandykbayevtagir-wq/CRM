import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { seed, seedPayment, seedVisit, testDatabase, requestContext } from "./d1";
import type { CrmEnv } from "../functions/_lib/env";
import { onRequestPost as expense } from "../functions/api/finance";
import { onRequestPatch as editExpense, onRequestDelete as voidExpense } from "../functions/api/finance/[id]";
import { onRequestPost as rent } from "../functions/api/rent";
import { onRequestPost as utilities } from "../functions/api/utilities";
import { onRequestPatch as editRent } from "../functions/api/rent/[id]";
import { onRequestPatch as editUtilities } from "../functions/api/utilities/[id]";
import { onRequestPost as adjustment } from "../functions/api/payroll/adjustment";
import { onRequestPost as payment } from "../functions/api/payments";
import { onRequestPost as refund } from "../functions/api/payments/refund";
import { onRequestPatch as updateVisit } from "../functions/api/appointments/[id]";
import { onRequestPost as book } from "../functions/api/client/appointments";
import { onRequestPost as operationAction } from "../functions/api/operations";
import { onRequestGet as health } from "../functions/api/health";
import { getSessionUser } from "../functions/_lib/auth";
import { calculatePayrollPeriod, closePayrollPeriod } from "../functions/_lib/payroll";
import { enqueueDueReminders, processOutbox } from "../functions/_lib/notification-delivery";
import { errorResponse } from "../functions/_lib/security";
import { runNotifications } from "../workers/notifications";
import { APP_VERSION } from "../src/lib/release";

let db: D1Database;
let sqlite: DatabaseSync;
beforeEach(() => { ({ db, sqlite } = testDatabase()); seed(sqlite); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); sqlite.close(); });
const count = (table: string) => Number(sqlite.prepare("SELECT COUNT(*) AS n FROM " + table).get()?.n);
async function call(handler: PagesFunction<CrmEnv>, path: string, method: string, body?: Record<string, unknown>, params: Record<string, string> = {}, database = db, userId = "owner") {
  const { context } = await requestContext(database, path, method, body, userId, params);
  let response: Response;
  try { response = await handler(context) as Response; } catch (error) { response = errorResponse(error, "test-request"); }
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}
function period() { sqlite.exec("INSERT INTO payroll_periods(id,period_start,period_end) VALUES('period','2030-01-01T00:00:00Z','2030-02-01T00:00:00Z')"); }
async function owner() { const { context } = await requestContext(db, "/"); return (await getSessionUser(context.request, db))!; }
async function reminder() {
  seedVisit(sqlite, "visit", "CONFIRMED", new Date(Date.now() + 3600000).toISOString());
  sqlite.exec("INSERT INTO notifications(id,client_id,appointment_id,kind,scheduled_at) VALUES('reminder','client','visit','REMINDER_2H',datetime('now','-1 minute'))");
  const { context } = await requestContext(db, "/");
  await enqueueDueReminders(context.env);
  return context.env;
}
const telegramOK = () => Response.json({ ok: true, result: { message_id: 42 } });

describe("retry-safe financial writes", () => {
  it.each([
    ["expense", expense, "/api/finance", { title: "Расход", amount: 1200 }, "expenses"],
    ["rent", rent, "/api/rent", { branchId: "branch", periodStart: "2030-01-01", dueDate: "2030-01-05", amount: 2000, status: "PAID" }, "rent_payments"],
    ["utility", utilities, "/api/utilities", { branchId: "branch", periodStart: "2030-01-01", dueDate: "2030-01-05", previousMeterValue: 1, currentMeterValue: 2.3, tariff: 0.1, fixedFee: 0, status: "PAID" }, "utility_payments"],
    ["adjustment", adjustment, "/api/payroll/adjustment", { periodId: "period", employeeId: "employee", kind: "BONUS", amount: 1000, reason: "Премия" }, "payroll_adjustments"],
  ] as const)("replays %s without duplicated effects", async (_name, handler, path, values, table) => {
    period();
    const body = { ...values, idempotencyKey: "same-request" };
    const first = await call(handler, path, "POST", body);
    const again = await call(handler, path, "POST", Object.fromEntries(Object.entries(body).reverse()));
    expect(first.status).toBe(201); expect(again.status).toBe(201);
    expect(again.body).toMatchObject({ id: first.body.id, replayed: true });
    expect(count(table)).toBe(1); expect(count("mutation_receipts")).toBe(1);
    expect(count("audit_logs")).toBe(1);
    const changed = await call(handler, path, "POST", { ...body, note: "Иная операция" });
    expect(changed.status).toBe(409); expect(count(table)).toBe(1);
  });
  it("rolls back the receipt and ledger when a later statement fails", async () => {
    sqlite.exec("CREATE TRIGGER qa_audit_failure BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'injected failure'); END");
    const body = { title: "Расход", amount: 100, idempotencyKey: "retry-after-rollback" };
    expect((await call(expense, "/api/finance", "POST", body)).status).toBe(500);
    expect(count("mutation_receipts")).toBe(0); expect(count("expenses")).toBe(0); expect(count("financial_transactions")).toBe(0);
    sqlite.exec("DROP TRIGGER qa_audit_failure");
    expect((await call(expense, "/api/finance", "POST", body)).status).toBe(201);
    expect(count("expenses")).toBe(1);
  });
  it("rejects sub-cent expense amounts without a receipt", async () => {
    expect((await call(expense, "/api/finance", "POST", { title: "Расход", amount: 0.001, idempotencyKey: "bad" })).status).toBe(400);
    expect(count("mutation_receipts")).toBe(0);
  });
  it("cannot resurrect an expense voided between the read and commit", async () => {
    const first = await call(expense, "/api/finance", "POST", { title: "Расход", amount: 100 });
    const id = String(first.body.id);
    const competing = { prepare: db.prepare.bind(db), async batch(statements: D1PreparedStatement[]) {
      sqlite.prepare("UPDATE financial_transactions SET status = 'VOIDED' WHERE expense_id = ?").run(id);
      sqlite.prepare("UPDATE expenses SET status = 'PLANNED' WHERE id = ?").run(id);
      return db.batch(statements);
    } } as D1Database;
    expect((await call(editExpense, "/api/finance/" + id, "PATCH", { amount: 200 }, { id }, competing)).status).toBe(409);
    expect(sqlite.prepare("SELECT status, amount FROM financial_transactions WHERE expense_id = ?").get(id)).toMatchObject({ status: "VOIDED", amount: 100 });
    expect((await call(voidExpense, "/api/finance/" + id, "DELETE", undefined, { id })).body.replayed).toBe(true);
  });
  it("checks committed identity rather than ambiguous trigger change counts", async () => {
    seedVisit(sqlite);
    const metadata = { prepare: db.prepare.bind(db), async batch(statements: D1PreparedStatement[]) {
      return (await db.batch(statements)).map((result) => ({ ...result, meta: { ...result.meta, changes: 99 } }));
    } } as D1Database;
    const paid = await call(payment, "/api/payments", "POST", { appointmentId: "visit", amount: 10000, method: "CASH", idempotencyKey: "paid" }, {}, metadata);
    expect(paid.status).toBe(201);
    expect((await call(refund, "/api/payments/refund", "POST", { paymentId: paid.body.paymentId, amount: 1000, reason: "Возврат", idempotencyKey: "refund" }, {}, metadata)).status).toBe(201);
  });
  it.each([
    [rent, editRent, "rent_payments", "/api/rent", { branchId: "branch", periodStart: "2030-01-01", dueDate: "2030-01-05", amount: 2000 }],
    [utilities, editUtilities, "utility_payments", "/api/utilities", { branchId: "branch", periodStart: "2030-01-01", dueDate: "2030-01-05", previousMeterValue: 0, currentMeterValue: 10, tariff: 100, fixedFee: 0 }],
  ] as const)("does not overwrite a concurrently changed obligation", async (create, edit, table, path, body) => {
    const created = await call(create, path, "POST", body); const id = String(created.body.id);
    const concurrent = { prepare: db.prepare.bind(db), async batch(statements: D1PreparedStatement[]) {
      sqlite.prepare("UPDATE " + table + " SET note = 'Изменено другим сотрудником' WHERE id = ?").run(id);
      return db.batch(statements);
    } } as D1Database;
    expect((await call(edit, path + "/" + id, "PATCH", { status: "PAID" }, { id }, concurrent)).status).toBe(409);
    expect(sqlite.prepare("SELECT status, note FROM " + table + " WHERE id = ?").get(id)).toMatchObject({ status: "PLANNED", note: "Изменено другим сотрудником" });
    expect(count("financial_transactions")).toBe(0);
  });
});

describe("payroll input revisions and frozen history", () => {
  it("rejects a stale calculation when payment arrives while the period is DRAFT", async () => {
    seedVisit(sqlite, "visit", "COMPLETED"); period();
    const actor = await owner();
    const concurrent = { prepare: db.prepare.bind(db), async batch(statements: D1PreparedStatement[]) {
      seedPayment(sqlite, "visit", 10000, "2030-01-07T04:00:00Z");
      return db.batch(statements);
    } } as D1Database;
    await expect(calculatePayrollPeriod(concurrent, "period", actor)).rejects.toThrow(/mutation_precondition/);
    expect(count("payroll_lines")).toBe(0);
    expect(sqlite.prepare("SELECT status, revision FROM payroll_periods").get()).toMatchObject({ status: "DRAFT", revision: 1 });
    await calculatePayrollPeriod(db, "period", actor);
    expect(sqlite.prepare("SELECT revenue_base FROM payroll_lines WHERE employee_id = 'employee'").get()?.revenue_base).toBe(10000);
  });
  it("invalidates an already calculated period when a paid visit becomes completed", async () => {
    seedVisit(sqlite, "visit", "IN_PROGRESS"); period();
    seedPayment(sqlite, "visit", 10000, "2030-01-07T04:00:00Z");
    const actor = await owner(); await calculatePayrollPeriod(db, "period", actor);
    expect((await call(updateVisit, "/api/appointments/visit", "PATCH", { status: "COMPLETED" }, { id: "visit" })).status).toBe(200);
    await expect(closePayrollPeriod(db, "period", actor)).rejects.toMatchObject({ code: "PAYROLL_NOT_CALCULATED" });
    await calculatePayrollPeriod(db, "period", actor);
    expect(sqlite.prepare("SELECT revenue_base FROM payroll_lines WHERE employee_id = 'employee'").get()?.revenue_base).toBe(10000);
  });
  it("invalidates salary changes but never rewrites a closed snapshot", async () => {
    period(); const actor = await owner(); await calculatePayrollPeriod(db, "period", actor);
    sqlite.exec("UPDATE employees SET fixed_salary = 100 WHERE id = 'employee'");
    expect(sqlite.prepare("SELECT status FROM payroll_periods").get()?.status).toBe("DRAFT");
    await calculatePayrollPeriod(db, "period", actor); await closePayrollPeriod(db, "period", actor);
    sqlite.exec("UPDATE employees SET fixed_salary = 200 WHERE id = 'employee'");
    expect(sqlite.prepare("SELECT status, total_amount FROM payroll_periods").get()).toMatchObject({ status: "CLOSED", total_amount: 100 });
    expect(() => sqlite.exec("UPDATE financial_transactions SET amount = 0 WHERE kind = 'SALARY'")).toThrow("CRM_LEDGER_IMMUTABLE");
  });
  it("freezes completed services and original payments", () => {
    seedVisit(sqlite, "visit", "COMPLETED"); seedPayment(sqlite, "visit", 10000, "2030-01-07T04:00:00Z");
    expect(() => sqlite.exec("UPDATE appointment_services SET price = 1 WHERE appointment_id = 'visit'")).toThrow("CRM_VISIT_CLOSED");
    expect(() => sqlite.exec("DELETE FROM appointment_services WHERE appointment_id = 'visit'")).toThrow("CRM_VISIT_CLOSED");
    expect(() => sqlite.exec("DELETE FROM appointments WHERE id = 'visit'")).toThrow("CRM_VISIT_CLOSED");
    expect(() => sqlite.exec("UPDATE payments SET amount = 1")).toThrow("CRM_LEDGER_IMMUTABLE");
    expect(() => sqlite.exec("DELETE FROM payments")).toThrow("CRM_LEDGER_IMMUTABLE");
    expect(() => sqlite.exec("DELETE FROM financial_transactions WHERE kind = 'PAYMENT'")).toThrow("CRM_LEDGER_IMMUTABLE");
  });
  it("allows an administrator to finish a visit after the specialist is archived", async () => {
    seedVisit(sqlite, "visit", "IN_PROGRESS");
    sqlite.exec("UPDATE employees SET is_active = 0 WHERE id = 'employee'; UPDATE employee_services SET active = 0 WHERE employee_id = 'employee'");
    expect((await call(updateVisit, "/api/appointments/visit", "PATCH", { status: "COMPLETED" }, { id: "visit" })).status).toBe(200);
  });
  it("updates legacy overlapping statuses without creating conflicting reservations", async () => {
    sqlite.exec("DROP TRIGGER appointment_overlap_insert");
    seedVisit(sqlite, "one", "SCHEDULED", "2030-01-07 04:00:00");
    seedVisit(sqlite, "two", "SCHEDULED", "2030-01-07 04:30:00");
    for (const id of ["one", "two"]) expect((await call(updateVisit, "/api/appointments/" + id, "PATCH", { status: "CONFIRMED" }, { id })).status).toBe(200);
    expect(count("appointment_slot_reservations")).toBe(0);
  });
});

describe("Telegram recovery and worker isolation", () => {
  it("settles a crashed final-attempt reminder and permits a real manual retry", async () => {
    const env = await reminder();
    sqlite.exec("UPDATE message_outbox SET status = 'PROCESSING', attempts = 5, lease_token = 'dead', lease_expires_at = datetime('now','-1 minute')");
    vi.stubGlobal("fetch", vi.fn(telegramOK));
    await processOutbox(env);
    expect(fetch).not.toHaveBeenCalled();
    expect(sqlite.prepare("SELECT status FROM notifications WHERE id = 'reminder'").get()?.status).toBe("FAILED");
    const { context, background } = await requestContext(db, "/api/operations", "POST", { messageId: "reminder-reminder" });
    expect((await operationAction(context) as Response).status).toBe(200); await Promise.all(background);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sqlite.prepare("SELECT status FROM notifications WHERE id = 'reminder'").get()?.status).toBe("SENT");
    expect(sqlite.prepare("SELECT status, telegram_message_id FROM message_outbox").get()).toMatchObject({ status: "SENT", telegram_message_id: 42 });
  });
  it("does not retry a reminder that has become obsolete", async () => {
    await reminder();
    sqlite.exec("UPDATE message_outbox SET status = 'FAILED'; UPDATE notifications SET status = 'FAILED'; UPDATE appointments SET status = 'CANCELLED' WHERE id = 'visit'");
    vi.stubGlobal("fetch", vi.fn(telegramOK));
    const { context, background } = await requestContext(db, "/api/operations", "POST", { messageId: "reminder-reminder" });
    await operationAction(context); await Promise.all(background);
    expect(fetch).not.toHaveBeenCalled();
    expect(sqlite.prepare("SELECT status FROM notifications WHERE id = 'reminder'").get()?.status).toBe("CANCELLED");
  });
  it("recovers campaign counters after a crashed final attempt and manual retry", async () => {
    const { context } = await requestContext(db, "/");
    sqlite.exec(`INSERT INTO campaigns(id,name,message,status,recipient_count) VALUES('campaign','Кампания','Привет','PROCESSING',1);
      INSERT INTO campaign_recipients(id,campaign_id,client_id,telegram_id) VALUES('recipient','campaign','client','200');
      INSERT INTO client_consents(id,client_id,kind,version) VALUES('consent','client','MARKETING','v1');
      INSERT INTO message_outbox(id,event_key,telegram_id,template_key,payload_json,status,attempts,lease_token,lease_expires_at)
      VALUES('campaign-message','campaign-event','200','CAMPAIGN','{"campaignId":"campaign","clientId":"client","message":"Привет"}','PROCESSING',5,'dead',datetime('now','-1 minute'))`);
    vi.stubGlobal("fetch", vi.fn(telegramOK)); await processOutbox(context.env);
    expect(sqlite.prepare("SELECT status, error_count FROM campaigns").get()).toMatchObject({ status: "COMPLETED", error_count: 1 });
    const retry = await requestContext(db, "/api/operations", "POST", { messageId: "campaign-message" });
    await operationAction(retry.context); await Promise.all(retry.background);
    expect(sqlite.prepare("SELECT status, sent_count, error_count FROM campaigns").get()).toMatchObject({ status: "COMPLETED", sent_count: 1, error_count: 0 });
    expect(sqlite.prepare("SELECT status FROM campaign_recipients").get()?.status).toBe("SENT");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("cancels a queued message after its client is archived", async () => {
    const env = await reminder();
    sqlite.exec("UPDATE clients SET is_active = 0 WHERE id = 'client'");
    vi.stubGlobal("fetch", vi.fn(telegramOK)); await processOutbox(env);
    expect(fetch).not.toHaveBeenCalled();
    expect(sqlite.prepare("SELECT status FROM message_outbox").get()?.status).toBe("CANCELLED");
  });
  it("marks booking notification sent only after Telegram acceptance", async () => {
    const { context } = await requestContext(db, "/api/client/appointments", "POST", { startsAt: "2030-01-07T04:00:00.000Z", serviceId: "service", branchId: "branch", employeeId: "employee", idempotencyKey: "booking" }, "user");
    expect((await book(context) as Response).status).toBe(201);
    expect(sqlite.prepare("SELECT status FROM notifications WHERE kind = 'BOOKING_CONFIRMED'").get()?.status).toBe("PENDING");
    vi.stubGlobal("fetch", vi.fn(telegramOK)); await processOutbox(context.env);
    expect(sqlite.prepare("SELECT status FROM notifications WHERE kind = 'BOOKING_CONFIRMED'").get()?.status).toBe("SENT");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("delivers messages even when bot configuration fails", async () => {
    const env = await reminder();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => String(input).endsWith("/sendMessage") ? telegramOK() : Response.json({ ok: false, error_code: 500 }, { status: 500 })));
    await runNotifications(env);
    expect(sqlite.prepare("SELECT status FROM message_outbox").get()?.status).toBe("SENT");
    expect(sqlite.prepare("SELECT status, lease_token FROM worker_runs WHERE worker_name = 'notifications'").get()).toMatchObject({ status: "OK", lease_token: null });
    expect(sqlite.prepare("SELECT status FROM worker_runs WHERE worker_name = ?").get("telegram-config-" + APP_VERSION)?.status).toBe("FAILED");
  });
  it("does not steal an active worker lease; recovers an expired one", async () => {
    const { context } = await requestContext(db, "/");
    sqlite.exec("INSERT INTO worker_runs(worker_name,started_at,status,lease_token,lease_expires_at) VALUES('notifications',CURRENT_TIMESTAMP,'RUNNING','alive',datetime('now','+2 minutes'))");
    vi.stubGlobal("fetch", vi.fn(telegramOK));
    await runNotifications(context.env); expect(fetch).not.toHaveBeenCalled();
    sqlite.exec("UPDATE worker_runs SET lease_expires_at = datetime('now','-1 minute')");
    await runNotifications(context.env);
    expect(sqlite.prepare("SELECT status, lease_token FROM worker_runs WHERE worker_name = 'notifications'").get()).toMatchObject({ status: "OK", lease_token: null });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("reports not ready if required recovery migration is missing", async () => {
    const { context } = await requestContext(db, "/api/health");
    expect((await health(context) as Response).status).toBe(200);
    sqlite.exec("DROP TABLE mutation_receipts");
    expect((await health(context) as Response).status).toBe(503);
  });
});
