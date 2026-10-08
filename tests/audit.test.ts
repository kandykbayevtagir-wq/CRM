import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { testDatabase, seed, seedRoles, seedVisit, seedPayment, requestContext, middlewareContext } from "./d1";
import type { CrmEnv } from "../functions/_lib/env";
import { onRequest as middleware } from "../functions/api/_middleware";
import { onRequestGet as clientsList } from "../functions/api/clients";
import { onRequestGet as clientDetail, onRequestDelete as archiveClient } from "../functions/api/clients/[id]";
import { onRequestGet as employeesList } from "../functions/api/employees";
import { onRequestPatch as patchEmployee } from "../functions/api/employees/[id]";
import { onRequestGet as servicesList } from "../functions/api/services";
import { onRequestGet as dashboard } from "../functions/api/dashboard";
import { onRequestGet as notifications } from "../functions/api/notifications";
import { onRequestPost as createUser } from "../functions/api/users";
import { onRequestPatch as patchSettings } from "../functions/api/settings";
import { onRequestGet as exportCsv } from "../functions/api/export";
import { onRequestPost as logout } from "../functions/api/auth/logout";
import { onRequestGet as clientProfile, onRequestPost as saveClientProfile } from "../functions/api/client/profile";
import { onRequestPost as clientBook } from "../functions/api/client/appointments";
import { onRequestPatch as clientCancel } from "../functions/api/client/appointments/[id]";
import { onRequestPatch as updateVisit } from "../functions/api/appointments/[id]";
import { onRequestPost as sendCampaign } from "../functions/api/campaigns/[id]/send";
import { prepareCampaigns } from "../functions/_lib/campaign-jobs";
import { onRequestPatch as patchSupplier } from "../functions/api/inventory/suppliers/[id]";
import { onRequestPatch as patchExpense, onRequestDelete as voidExpense } from "../functions/api/finance/[id]";
import { onRequestPost as createExpense } from "../functions/api/finance";
import { onRequestPost as receivePurchase } from "../functions/api/purchases/[id]/receive";
import { onRequestPatch as patchPurchase } from "../functions/api/purchases/[id]";
import { onRequestPost as createFollowUp } from "../functions/api/follow-ups";
import { onRequestPost as createPayment } from "../functions/api/payments";
import { onRequestGet as clientCatalog } from "../functions/api/client/catalog";

let db: D1Database;
let sqlite: DatabaseSync;
beforeEach(() => { ({ db, sqlite } = testDatabase()); seed(sqlite); seedRoles(sqlite); });
afterEach(() => { vi.unstubAllGlobals(); sqlite.close(); });
const count = (table: string, where = "1=1") => Number(sqlite.prepare(`SELECT COUNT(*) AS value FROM ${table} WHERE ${where}`).get()?.value);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function call(handler: PagesFunction<CrmEnv>, path: string, method = "GET", body?: Record<string, unknown>, userId = "owner", params: Record<string, string> = {}) {
  const { context } = await requestContext(db, path, method, body, userId, params);
  const response = await handler(context) as Response;
  const text = await response.text();
  let json: Json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, body: json as Json, text, headers: response.headers };
}

describe("role-scoped data", () => {
  it("hides client money and internal notes from specialists in the list and the card", async () => {
    seedVisit(sqlite, "done", "COMPLETED", "2029-01-07T04:00:00Z");
    seedPayment(sqlite, "done", 10000, "2029-01-07T05:00:00.000Z");
    const owner = await call(clientsList, "/api/clients?status=all");
    expect(owner.status).toBe(200);
    expect(owner.body.restricted).toBeFalsy();
    expect(owner.body.items.find((item: Json) => item.id === "client").total).toBe(10000);
    const specialist = await call(clientsList, "/api/clients?status=all", "GET", undefined, "specialist");
    expect(specialist.status).toBe(200);
    expect(specialist.body.restricted).toBe(true);
    for (const item of specialist.body.items) { expect(item.notes).toBeNull(); expect(item.total).toBeNull(); }
    const card = await call(clientDetail, "/api/clients/client", "GET", undefined, "specialist", { id: "client" });
    expect(card.body.restricted).toBe(true);
    expect(card.body.client.notes).toBeNull();
    expect(card.body.payments).toEqual([]);
    // Visit notes belong to the specialist's own appointments; only the client-level CRM note is hidden.
    expect(JSON.stringify(card.body.client)).not.toContain("Внутренняя заметка");
  });
  it("strips salary settings and revenue from roles without payroll access", async () => {
    sqlite.exec("UPDATE employees SET fixed_salary = 150000, revenue_percent = 30 WHERE id = 'employee'");
    const owner = await call(employeesList, "/api/employees");
    expect(owner.body.payrollVisible).toBe(true);
    expect(owner.body.items[0].fixedSalary).toBeDefined();
    const admin = await call(employeesList, "/api/employees", "GET", undefined, "admin");
    expect(admin.status).toBe(200);
    expect(admin.body.payrollVisible).toBe(false);
    for (const item of admin.body.items) { expect(item).not.toHaveProperty("fixedSalary"); expect(item).not.toHaveProperty("revenuePercent"); expect(item).not.toHaveProperty("revenue"); }
    expect(JSON.stringify(admin.body)).not.toContain("150000");
  });
  it("hides service cost prices from specialists and administrators", async () => {
    sqlite.exec("UPDATE services SET cost = 2500 WHERE id = 'service'");
    const owner = await call(servicesList, "/api/services");
    expect(owner.body.costVisible).toBe(true);
    expect(owner.body.items[0].cost).toBe(2500);
    for (const role of ["specialist", "admin"]) {
      const result = await call(servicesList, "/api/services", "GET", undefined, role);
      expect(result.status).toBe(200);
      expect(result.body.costVisible).toBe(false);
      expect(result.body.items[0].cost).toBeNull();
    }
  });
  it("returns null finance and payroll totals on the dashboard for administrators", async () => {
    const admin = await call(dashboard, "/api/dashboard", "GET", undefined, "admin");
    expect(admin.status).toBe(200);
    expect(admin.body.metrics.expenses).toBeNull();
    expect(admin.body.metrics.payroll).toBeNull();
    expect(typeof admin.body.metrics.revenue).toBe("number");
    const owner = await call(dashboard, "/api/dashboard");
    expect(typeof owner.body.metrics.expenses).toBe("number");
    expect(typeof owner.body.metrics.payroll).toBe("number");
    expect(owner.body.period.timezone).toBe("Asia/Almaty");
  });
  it("gates notification feeds by permission", async () => {
    sqlite.exec("INSERT INTO rent_payments(id,branch_id,period_start,amount,due_date,status) VALUES('rent','branch','2030-01-01',250000,date('now'),'DUE')");
    sqlite.exec("INSERT INTO audit_logs(id,actor_id,entity_type,entity_id,action) VALUES('log','owner','payment','x','CREATE')");
    const owner = await call(notifications, "/api/notifications");
    expect(owner.body.items.some((item: Json) => item.kind === "RENT")).toBe(true);
    expect(owner.body.items.some((item: Json) => item.kind === "AUDIT")).toBe(true);
    const admin = await call(notifications, "/api/notifications", "GET", undefined, "admin");
    expect(admin.status).toBe(200);
    expect(admin.body.items.some((item: Json) => item.kind === "RENT")).toBe(false);
    expect(admin.body.items.some((item: Json) => item.kind === "AUDIT")).toBe(false);
    expect(JSON.stringify(admin.body)).not.toContain("250");
    const specialist = await call(notifications, "/api/notifications", "GET", undefined, "specialist");
    expect(specialist.body.items.some((item: Json) => ["RENT", "UTILITIES", "AUDIT", "UNPAID_APPOINTMENT"].includes(item.kind))).toBe(false);
  });
});

describe("ownership and IDOR", () => {
  it("does not let a client cancel another client's appointment", async () => {
    seedVisit(sqlite, "theirs", "SCHEDULED", "2030-01-07T04:00:00Z", "employee", "other-client");
    const result = await call(clientCancel, "/api/client/appointments/theirs", "PATCH", { reason: "x" }, "user", { id: "theirs" });
    expect(result.status).toBe(404);
    expect(sqlite.prepare("SELECT status FROM appointments WHERE id = 'theirs'").get()?.status).toBe("SCHEDULED");
  });
  it("does not let a specialist change another specialist's appointment", async () => {
    seedVisit(sqlite, "foreign", "SCHEDULED", "2030-01-07T04:00:00Z", "other-employee");
    const result = await call(updateVisit, "/api/appointments/foreign", "PATCH", { status: "CONFIRMED", revision: 0 }, "specialist", { id: "foreign" });
    expect(result.status).toBe(403);
    expect(sqlite.prepare("SELECT status FROM appointments WHERE id = 'foreign'").get()?.status).toBe("SCHEDULED");
  });
  it("cuts portal access when the client card is archived", async () => {
    const before = await call(clientProfile, "/api/client/profile", "GET", undefined, "user");
    expect(before.body.profile.id).toBe("client");
    const archived = await call(archiveClient, "/api/clients/client", "DELETE", undefined, "owner", { id: "client" });
    expect(archived.status).toBe(200);
    expect(count("sessions", "user_id = 'user'")).toBe(0);
    const after = await call(clientProfile, "/api/client/profile", "GET", undefined, "user");
    expect(after.body.archived).toBe(true);
    expect(after.body.profile).toBeNull();
    const catalog = await call(clientCatalog, "/api/client/catalog", "GET", undefined, "user");
    expect(catalog.body.archived).toBe(true);
    expect(catalog.body.profile).toBeNull();
    const booking = await call(clientBook, "/api/client/appointments", "POST", { startsAt: "2030-01-07T04:00:00.000Z", serviceId: "service", branchId: "branch", employeeId: "employee", idempotencyKey: "archived-key" }, "user");
    expect(booking.status).toBe(403);
    expect(count("appointments")).toBe(0);
  });
  it("refuses to reuse another user's booking idempotency key", async () => {
    const body = { startsAt: "2030-01-07T04:00:00.000Z", serviceId: "service", branchId: "branch", employeeId: "employee", idempotencyKey: "shared-key" };
    expect((await call(clientBook, "/api/client/appointments", "POST", body, "user")).status).toBe(201);
    const stranger = await call(clientBook, "/api/client/appointments", "POST", { ...body, startsAt: "2030-01-07T06:00:00.000Z" }, "other-user");
    expect(stranger.status).toBe(409);
    expect(count("appointments")).toBe(1);
  });
});

describe("validation and hardening", () => {
  it("validates Telegram IDs, roles and client links when inviting users", async () => {
    expect((await call(createUser, "/api/users", "POST", { telegramId: "abc", name: "X", role: "ADMINISTRATOR" })).status).toBe(400);
    expect((await call(createUser, "/api/users", "POST", { telegramId: "777", name: "X", role: "SUPERUSER" })).status).toBe(400);
    expect((await call(createUser, "/api/users", "POST", { telegramId: "778", name: "X", role: "CLIENT" })).status).toBe(400);
    const ok = await call(createUser, "/api/users", "POST", { telegramId: "779", name: "Новый", role: "ACCOUNTANT", username: "@new" });
    expect(ok.status).toBe(201);
    expect(count("users", "telegram_id = '779' AND role = 'ACCOUNTANT'")).toBe(1);
    expect((await call(createUser, "/api/users", "POST", { telegramId: "779", name: "Дубль", role: "ACCOUNTANT" })).status).toBe(409);
  });
  it("normalises settings input instead of storing junk", async () => {
    const result = await call(patchSettings, "/api/settings", "PATCH", { brandName: "  Центр  ", workingDays: "1, 2,x,9,2", bookingSlotInterval: 7, cancellationWindowHours: 500, loyaltyPointsPer1000: -4 });
    expect(result.status).toBe(200);
    const row = sqlite.prepare("SELECT brand_name AS brandName, working_days AS workingDays, booking_slot_interval AS slot, cancellation_window_hours AS hours, loyalty_points_per_1000 AS points FROM organization_settings WHERE id = 1").get() as Json;
    expect(row.workingDays).toBe("1,2");
    expect(row.slot).toBe(15);
    expect(row.hours).toBe(72);
    expect(row.points).toBe(0);
    expect(row.brandName).toBe("Центр");
  });
  it("escapes LIKE wildcards in client search", async () => {
    sqlite.exec("INSERT INTO clients(id,full_name,phone,phone_normalized,is_active) VALUES('percent','Скидка 100% клиент','77001112233','77001112233',1)");
    const wildcard = await call(clientsList, "/api/clients?q=%25");
    expect(wildcard.body.items.map((item: Json) => item.id)).toEqual(["percent"]);
    const underscore = await call(clientsList, "/api/clients?q=_");
    expect(underscore.body.items).toEqual([]);
    const plain = await call(clientsList, "/api/clients?q=" + encodeURIComponent("100%"));
    expect(plain.body.items.map((item: Json) => item.id)).toEqual(["percent"]);
  });
  it("returns 404 for payments on unknown appointments", async () => {
    const result = await call(createPayment, "/api/payments", "POST", { appointmentId: "missing", amount: 100, method: "CASH", idempotencyKey: "p-404" });
    expect(result.status).toBe(404);
  });
  it("answers 409 for a second open follow-up on the same appointment", async () => {
    seedVisit(sqlite, "visit", "COMPLETED", "2029-01-07T04:00:00Z");
    expect((await call(createFollowUp, "/api/follow-ups", "POST", { clientId: "client", appointmentId: "visit", intervalDays: 30 })).status).toBe(201);
    expect((await call(createFollowUp, "/api/follow-ups", "POST", { clientId: "client", appointmentId: "visit", intervalDays: 30 })).status).toBe(409);
  });
});

describe("exports", () => {
  it("applies the export permission matrix and emits UTF-8 CSV with a BOM", async () => {
    sqlite.exec("INSERT INTO products(id,name,sku,unit,purchase_price,sale_price,min_stock,optimal_stock,is_active) VALUES('product','Бинт','SKU-1','шт',100,0,1,5,1)");
    expect((await call(exportCsv, "/api/export?type=clients", "GET", undefined, "specialist")).status).toBe(403);
    expect((await call(exportCsv, "/api/export?type=payroll", "GET", undefined, "admin")).status).toBe(403);
    expect((await call(exportCsv, "/api/export?type=unknown")).status).toBe(403);
    const { context } = await requestContext(db, "/api/export?type=inventory", "GET", undefined, "owner");
    const inventory = await exportCsv(context) as Response;
    expect(inventory.status).toBe(200);
    expect(inventory.headers.get("content-type")).toContain("text/csv");
    // Response.text() strips the BOM, so check the raw bytes.
    const bytes = new Uint8Array(await inventory.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toContain("SKU-1");
    const pnl = await call(exportCsv, "/api/export?type=pnl&from=2030-01-01&to=2030-01-31");
    expect(pnl.status).toBe(200);
  });
});

describe("sessions and middleware", () => {
  it("lets a user without a valid session hit logout and clears a cross-site capable cookie", async () => {
    const result = await middleware(await middlewareContext(db, "/api/auth/logout", { method: "POST", headers: { origin: "https://crm.test" }, userId: null }));
    expect(result.status).toBe(200);
    const direct = await call(logout, "/api/auth/logout", "POST", {}, "owner");
    const cookie = direct.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("SameSite=None");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Max-Age=0");
    expect(count("sessions", "user_id = 'owner'")).toBe(0);
  });
  it("rejects anonymous, cross-site and non-allow-listed requests before handlers run", async () => {
    const anonymous = await middleware(await middlewareContext(db, "/api/clients", { userId: null }));
    expect(anonymous.status).toBe(401);
    const crossSite = await middleware(await middlewareContext(db, "/api/clients", { method: "POST", headers: { origin: "https://evil.test", "content-type": "application/json" }, body: "{}", userId: "owner" }));
    expect(crossSite.status).toBe(403);
    const notAllowed = await middleware(await middlewareContext(db, "/api/clients", { userId: "specialist", allowed: "100" }));
    expect(notAllowed.status).toBe(403);
    const ok = await middleware(await middlewareContext(db, "/api/clients", { userId: "specialist", allowed: "100,400" }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const oversized = await middleware(await middlewareContext(db, "/api/clients", { method: "POST", headers: { origin: "https://crm.test", "content-length": "200000", "content-type": "application/json" }, body: "{}", userId: "owner" }));
    expect(oversized.status).toBe(413);
  });
});

describe("campaigns, consents and data integrity", () => {
  it("counts only clients who opted into marketing as campaign recipients", async () => {
    sqlite.exec("INSERT INTO campaigns(id,name,message,status,created_by) VALUES('campaign','Акция','Скидка 10%','DRAFT','owner')");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, result: { message_id: 1 } })));
    const empty = await call(sendCampaign, "/api/campaigns/campaign/send", "POST", {}, "owner", { id: "campaign" });
    expect(empty.status).toBe(202);
    expect(count("message_outbox")).toBe(0);
    const {context}=await requestContext(db,"/");
    await prepareCampaigns(context.env);
    expect(sqlite.prepare("SELECT status FROM campaigns WHERE id = 'campaign'").get()?.status).toBe("COMPLETED");
    sqlite.exec("UPDATE campaigns SET status='DRAFT' WHERE id='campaign'");
    const consent = await call(saveClientProfile, "/api/client/profile", "POST", { fullName: "Клиент", phone: "+7 700 123 45 67", allowReminders: true, allowMarketing: true }, "user");
    expect(consent.status).toBe(200);
    expect(count("client_consents", "client_id = 'client' AND kind = 'MARKETING' AND revoked_at IS NULL")).toBe(1);
    const sent = await call(sendCampaign, "/api/campaigns/campaign/send", "POST", {}, "owner", { id: "campaign" });
    expect(sent.status).toBe(202);
    await prepareCampaigns(context.env);
    expect(sqlite.prepare("SELECT recipient_count FROM campaigns WHERE id='campaign'").get()?.recipient_count).toBe(1);
    expect(count("message_outbox")).toBe(1);
    const revoke = await call(saveClientProfile, "/api/client/profile", "POST", { fullName: "Клиент", phone: "+7 700 123 45 67", allowReminders: true, allowMarketing: false }, "user");
    expect(revoke.status).toBe(200);
    expect(count("client_consents", "client_id = 'client' AND kind = 'MARKETING' AND revoked_at IS NULL")).toBe(0);
  });
  it("keeps an archived supplier archived when only contacts change", async () => {
    sqlite.exec("INSERT INTO suppliers(id,name,is_active) VALUES('supplier','Поставщик',0)");
    const result = await call(patchSupplier, "/api/inventory/suppliers/supplier", "PATCH", { phone: "+77001234567" }, "owner", { id: "supplier" });
    expect(result.status).toBe(200);
    expect(sqlite.prepare("SELECT is_active AS active FROM suppliers WHERE id = 'supplier'").get()?.active).toBe(0);
    await call(patchSupplier, "/api/inventory/suppliers/supplier", "PATCH", { isActive: true }, "owner", { id: "supplier" });
    expect(sqlite.prepare("SELECT is_active AS active FROM suppliers WHERE id = 'supplier'").get()?.active).toBe(1);
  });
  it("does not re-post a voided expense through an edit", async () => {
    const created = await call(createExpense, "/api/finance", "POST", { title: "Аренда", category: "RENT", amount: 1000, occurredAt: "2030-01-10T10:00", status: "PAID" });
    expect(created.status).toBe(201);
    expect((await call(voidExpense, "/api/finance/" + created.body.id, "DELETE", undefined, "owner", { id: created.body.id })).status).toBe(200);
    expect(count("financial_transactions", "expense_id = '" + created.body.id + "' AND status = 'VOIDED'")).toBe(1);
    const edit = await call(patchExpense, "/api/finance/" + created.body.id, "PATCH", { amount: 5000, status: "PAID" }, "owner", { id: created.body.id });
    expect(edit.status).toBe(409);
    expect(count("financial_transactions", "expense_id = '" + created.body.id + "' AND status = 'POSTED'")).toBe(0);
  });
  it("receives stock only for ordered purchases, never twice, and replays by key", async () => {
    sqlite.exec(`
      INSERT INTO products(id,name,sku,unit,purchase_price,sale_price,min_stock,optimal_stock,is_active) VALUES('product','Бинт','SKU-1','шт',100,0,1,5,1);
      INSERT INTO purchases(id,branch_id,order_date,status,total_amount,created_by) VALUES('purchase','branch','2030-01-01T05:00:00.000Z','DRAFT',1000,'owner');
      INSERT INTO purchase_items(id,purchase_id,product_id,ordered_quantity,received_quantity,unit_cost) VALUES('item','purchase','product',10,0,100);
    `);
    const items = [{ purchaseItemId: "item", quantity: 10 }];
    expect((await call(receivePurchase, "/api/purchases/purchase/receive", "POST", { items, idempotencyKey: "r1" }, "owner", { id: "purchase" })).status).toBe(400);
    expect((await call(patchPurchase, "/api/purchases/purchase", "PATCH", { status: "RECEIVED" }, "owner", { id: "purchase" })).status).toBe(400);
    expect((await call(patchPurchase, "/api/purchases/purchase", "PATCH", { status: "ORDERED", paidAmount: -5 }, "owner", { id: "purchase" })).status).toBe(400);
    expect((await call(patchPurchase, "/api/purchases/purchase", "PATCH", { status: "ORDERED" }, "owner", { id: "purchase" })).status).toBe(200);
    const first = await call(receivePurchase, "/api/purchases/purchase/receive", "POST", { items, idempotencyKey: "r1" }, "owner", { id: "purchase" });
    expect(first.status).toBe(200);
    expect(count("stock_movements", "product_id = 'product'")).toBe(1);
    expect(sqlite.prepare("SELECT status FROM purchases WHERE id = 'purchase'").get()?.status).toBe("RECEIVED");
    const replay = await call(receivePurchase, "/api/purchases/purchase/receive", "POST", { items, idempotencyKey: "r1" }, "owner", { id: "purchase" });
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    const again = await call(receivePurchase, "/api/purchases/purchase/receive", "POST", { items, idempotencyKey: "r2" }, "owner", { id: "purchase" });
    expect(again.status).toBe(400);
    expect(count("stock_movements", "product_id = 'product'")).toBe(1);
    expect((await call(patchPurchase, "/api/purchases/purchase", "PATCH", { status: "DRAFT" }, "owner", { id: "purchase" })).status).toBe(400);
  });
  it("keeps employee branches when a salary-only update arrives", async () => {
    const result = await call(patchEmployee, "/api/employees/employee", "PATCH", { fixedSalary: 120000 }, "owner", { id: "employee" });
    expect(result.status).toBe(200);
    expect(count("employee_branches", "employee_id = 'employee'")).toBe(1);
    expect(sqlite.prepare("SELECT fixed_salary AS salary FROM employees WHERE id = 'employee'").get()?.salary).toBe(120000);
    expect((await call(patchEmployee, "/api/employees/employee", "PATCH", { branchIds: [] }, "owner", { id: "employee" })).status).toBe(400);
    expect(count("employee_branches", "employee_id = 'employee'")).toBe(1);
  });
});
