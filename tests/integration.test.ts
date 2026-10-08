import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { testDatabase, seed, seedVisit, requestContext } from "./d1";
import { onRequestPost as payment } from "../functions/api/payments";
import { onRequestPost as refund } from "../functions/api/payments/refund";
import { onRequestPatch as updateVisit } from "../functions/api/appointments/[id]";
import { onRequestPost as book } from "../functions/api/client/appointments";
import { onRequestGet as profile, onRequestPost as saveProfile } from "../functions/api/client/profile";
import { onRequestPost as checkin } from "../functions/api/checkin";
import { onRequestGet as calendar } from "../functions/api/client/calendar";
import { onRequestGet as operations } from "../functions/api/operations";
import { onRequestPost as operationAction } from "../functions/api/operations";
import { onRequestGet as clientCatalog } from "../functions/api/client/catalog";
import { onRequestPost as waitlistRequest } from "../functions/api/client/waitlist";
import { onRequestPost as webhook } from "../functions/api/telegram/webhook";
import { enqueueDueReminders, processOutbox } from "../functions/_lib/notification-delivery";
import { calculatePayrollPeriod, closePayrollPeriod } from "../functions/_lib/payroll";
import { getSessionUser } from "../functions/_lib/auth";
import { findAvailableSlots } from "../functions/_lib/availability";

let db: D1Database;
let sqlite: DatabaseSync;
beforeEach(() => { ({db,sqlite} = testDatabase()); seed(sqlite); });
afterEach(() => { vi.unstubAllGlobals(); sqlite.close(); });
const count = (table: string) => Number(sqlite.prepare("SELECT COUNT(*) AS value FROM " + table).get()?.value);
async function call(handler: PagesFunction<import("../functions/_lib/env").CrmEnv>, path: string, method: string, body?: Record<string, unknown>, userId = "owner", params: Record<string,string> = {}) {
  const { context } = await requestContext(db,path,method,body,userId,params);
  const response = await handler(context) as Response;
  return { status: response.status, body: await response.json() as { id: string; paymentId: string; replayed: boolean; profile: { notes: string } } };
}
describe("database migrations and booking integrity", () => {
  it("applies every migration with valid foreign keys", () => {
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(count("mutation_guards")).toBe(0);
  });
  it("rejects overlapping legacy and ISO intervals inside the database", () => {
    seedVisit(sqlite,"old","SCHEDULED","2030-01-07 04:00:00");
    expect(() => seedVisit(sqlite,"new","SCHEDULED","2030-01-07T04:30:00Z")).toThrow("CRM_SLOT_UNAVAILABLE");
    seedVisit(sqlite,"adjacent","SCHEDULED","2030-01-07T05:00:00Z");
  });
  it("returns the same client booking after a network retry", async () => {
    const body = { startsAt:"2030-01-07T04:00:00.000Z",serviceId:"service",branchId:"branch",employeeId:"employee",idempotencyKey:"booking-key" };
    const first = await call(book,"/api/client/appointments","POST",body,"user");
    const second = await call(book,"/api/client/appointments","POST",body,"user");
    expect(first.status).toBe(201); expect(second.body.id).toBe(first.body.id);
    expect(second.body.replayed).toBe(true); expect(count("appointments")).toBe(1);
    expect(count("appointment_slot_reservations")).toBe(4);
  });
  it("does not offer occupied slots when old records use SQLite timestamps", async () => {
    seedVisit(sqlite,"legacy","SCHEDULED","2030-01-07 04:00:00");
    const slots=await findAvailableSlots(db,{date:"2030-01-07",branchId:"branch",serviceId:"service",employeeId:"employee"});
    expect(slots.some(slot=>slot.startsAt==="2030-01-07T04:00:00.000Z")).toBe(false);
    expect(slots.some(slot=>slot.startsAt==="2030-01-07T04:30:00.000Z")).toBe(false);
    expect(slots.some(slot=>slot.startsAt==="2030-01-07T05:00:00.000Z")).toBe(true);
  });
  it("does not modify an appointment when a competing booking takes its slot", async () => {
    seedVisit(sqlite);
    const result = await call(book,"/api/client/appointments","POST",{startsAt:"2030-01-07T04:00:00.000Z",serviceId:"service",branchId:"branch",employeeId:"employee",idempotencyKey:"other-key"},"other-user");
    expect(result.status).toBe(409); expect(count("appointments")).toBe(1);
  });
  it("rejects a stale administrator action without status or audit side effects", async () => {
    seedVisit(sqlite); sqlite.exec("UPDATE appointments SET status='CONFIRMED' WHERE id='visit'");
    const before = count("audit_logs");
    const result = await call(updateVisit,"/api/appointments/visit","PATCH",{status:"ARRIVED",revision:0},"owner",{id:"visit"});
    expect(result.status).toBe(409); expect(count("audit_logs")).toBe(before);
  });
  it("commits completed status, consumables, history and loyalty together and awards once", async () => {
    seedVisit(sqlite,"visit","IN_PROGRESS");
    expect((await call(updateVisit,"/api/appointments/visit","PATCH",{status:"COMPLETED"},"owner",{id:"visit"})).status).toBe(200);
    expect((await call(updateVisit,"/api/appointments/visit","PATCH",{status:"COMPLETED"},"owner",{id:"visit"})).status).toBe(200);
    expect(count("loyalty_transactions")).toBe(1);
    expect(sqlite.prepare("SELECT points_balance FROM loyalty_accounts WHERE client_id='client'").get()?.points_balance).toBe(10);
    expect(() => sqlite.exec("UPDATE appointments SET status='CANCELLED' WHERE id='visit'")).toThrow("CRM_VISIT_CLOSED");
  });
});
describe("payments and closed payroll", () => {
  it("prevents duplicate payment, overpayment and ledger drift", async () => {
    seedVisit(sqlite);
    const body={appointmentId:"visit",amount:6000,method:"CASH",idempotencyKey:"payment-key"};
    expect((await call(payment,"/api/payments","POST",body)).status).toBe(201);
    expect((await call(payment,"/api/payments","POST",body)).body.replayed).toBe(true);
    expect((await call(payment,"/api/payments","POST",{...body,idempotencyKey:"second-key"})).status).toBe(409);
    expect(count("payments")).toBe(1); expect(count("financial_transactions")).toBe(1);
    expect((await call(payment,"/api/payments","POST",{...body,amount:0.001,idempotencyKey:"fraction"})).status).toBe(400);
  });
  it("prevents refund retries and refunds larger than the actual payment", async () => {
    seedVisit(sqlite);
    const paid=await call(payment,"/api/payments","POST",{appointmentId:"visit",amount:10000,method:"CARD",idempotencyKey:"pay"});
    const body={paymentId:paid.body.paymentId,amount:6000,reason:"Частичный возврат",idempotencyKey:"refund"};
    expect((await call(refund,"/api/payments/refund","POST",body)).status).toBe(201);
    expect((await call(refund,"/api/payments/refund","POST",body)).body.replayed).toBe(true);
    expect((await call(refund,"/api/payments/refund","POST",{...body,idempotencyKey:"again"})).status).toBe(409);
    expect(count("payment_adjustments")).toBe(1); expect(count("financial_transactions")).toBe(2);
  });
  it("freezes payroll lines and all adjustments when a period closes", async () => {
    sqlite.exec("INSERT INTO payroll_periods(id,period_start,period_end) VALUES('period','2030-01-01T00:00:00Z','2030-02-01T00:00:00Z')");
    const {context}=await requestContext(db,"/","GET");
    const owner=await getSessionUser(context.request,db);
    await calculatePayrollPeriod(db,"period",owner!); await closePayrollPeriod(db,"period",owner!);
    expect(() => sqlite.exec("UPDATE payroll_lines SET total_amount=1 WHERE period_id='period'")).toThrow("CRM_PAYROLL_CLOSED");
    expect(() => sqlite.exec("INSERT INTO payroll_adjustments(id,employee_id,period_id,kind,amount,reason) VALUES('adj','employee','period','BONUS',100,'test')")).toThrow("CRM_PAYROLL_CLOSED");
    await closePayrollPeriod(db,"period",owner!);
    expect(count("financial_transactions")).toBe(1);
  });
  it("rejects negative stock at the database level", () => {
    sqlite.exec("INSERT INTO products(id,name,sku,unit) VALUES('product','Материал','SKU','шт')");
    expect(() => sqlite.exec("INSERT INTO stock_movements(id,product_id,branch_id,movement_type,direction,quantity,unit_price,total_cost,source) VALUES('stock','product','branch','MANUAL_OUT','OUT',1,0,0,'MANUAL')")).toThrow("CRM_INSUFFICIENT_STOCK");
  });
});
describe("ownership and privacy", () => {
  it("does not expose internal service costs to a client", async () => {
    sqlite.exec("UPDATE services SET cost = 7777 WHERE id = 'service'");
    const {context}=await requestContext(db,"/api/client/catalog","GET",undefined,"user");
    const response=await clientCatalog(context) as Response;
    const result=await response.json() as {services:Record<string,unknown>[]};
    expect(result.services[0].price).toBe(10000);
    expect(result.services[0]).not.toHaveProperty("cost");
  });
  it("makes waitlist requests visible and closable only by administrators", async () => {
    expect((await call(waitlistRequest,"/api/client/waitlist","POST",{serviceId:"service",branchId:"branch",preferredDate:"2030-02-30"},"user")).status).toBe(400);
    const saved=await call(waitlistRequest,"/api/client/waitlist","POST",{serviceId:"service",branchId:"branch",preferredDate:"2030-01-07"},"user");
    expect(saved.status).toBe(201);
    const {context}=await requestContext(db,"/api/operations","GET");
    const response=await operations(context) as Response;
    const result=await response.json() as {waitlist:{id:string}[]};
    expect(result.waitlist.map(item=>item.id)).toContain(saved.body.id);
    const action={action:"close_waitlist",waitlistId:saved.body.id};
    expect((await call(operationAction,"/api/operations","POST",action,"user")).status).toBe(403);
    expect((await call(operationAction,"/api/operations","POST",action)).status).toBe(200);
    const auditCount=count("audit_logs");
    expect((await call(operationAction,"/api/operations","POST",action)).body.replayed).toBe(true);
    expect(count("audit_logs")).toBe(auditCount);
  });
  it("does not show or overwrite internal CRM notes in the client profile", async () => {
    const result=await call(profile,"/api/client/profile","GET",undefined,"user");
    expect(result.body.profile.notes).toBe("Личное предпочтение");
    await call(saveProfile,"/api/client/profile","POST",{fullName:"Клиент",phone:"77001234567",notes:"Новое предпочтение",allowReminders:true},"user");
    expect(sqlite.prepare("SELECT notes FROM clients WHERE id='client'").get()?.notes).toBe("Внутренняя заметка");
  });
  it("does not let a stranger claim an existing client card by phone", async () => {
    sqlite.exec("UPDATE users SET client_id=NULL WHERE id='other-user'");
    expect((await call(saveProfile,"/api/client/profile","POST",{fullName:"Другой",phone:"77001234567"},"other-user")).status).toBe(400);
  });
  it("scopes check-in codes to the specialist's own appointments", async () => {
    seedVisit(sqlite,"visit","SCHEDULED",undefined,"other-employee");
    expect((await call(checkin,"/api/checkin","POST",{appointmentId:"visit"},"specialist")).status).toBe(403);
    expect((await call(checkin,"/api/checkin","POST",{token:"TOKENVISIT"},"specialist")).status).toBe(403);
  });
  it("exports a calendar event only to the appointment's client", async () => {
    seedVisit(sqlite);
    const own=await requestContext(db,"/api/client/calendar?appointmentId=visit","GET",undefined,"user");
    expect((await calendar(own.context) as Response).headers.get("content-type")).toContain("text/calendar");
    const other=await requestContext(db,"/api/client/calendar?appointmentId=visit","GET",undefined,"other-user");
    expect((await calendar(other.context) as Response).status).toBe(404);
  });
  it("keeps operational diagnostics private and validates dates", async () => {
    expect((await call(operations,"/api/operations","GET",undefined,"user")).status).toBe(403);
    expect((await call(operations,"/api/operations?date=2026-99-01","GET")).status).toBe(400);
    expect((await call(operations,"/api/operations?date=2030-01-07","GET")).status).toBe(200);
  });
});
describe("Telegram outbox and webhook", () => {
  it("claims a message once across overlapping workers", async () => {
    sqlite.exec(`INSERT INTO message_outbox(id,event_key,telegram_id,template_key,payload_json) VALUES('message','event','200','DIRECT','{"message":"Привет"}')`);
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json({ok:true,result:{message_id:1}})));
    const {context}=await requestContext(db,"/");
    await Promise.all([processOutbox(context.env),processOutbox(context.env)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sqlite.prepare("SELECT status FROM message_outbox").get()?.status).toBe("SENT");
  });
  it("does not send a reminder after a cancellation or opt-out", async () => {
    const starts=new Date(Date.now()+3600000).toISOString();
    seedVisit(sqlite,"visit","CONFIRMED",starts);
    sqlite.exec("INSERT INTO notifications(id,client_id,appointment_id,kind,scheduled_at) VALUES('reminder','client','visit','REMINDER_2H',datetime('now','-1 minute'))");
    const {context}=await requestContext(db,"/");
    await enqueueDueReminders(context.env); await enqueueDueReminders(context.env);
    expect(count("message_outbox")).toBe(1);
    sqlite.exec("UPDATE users SET notifications_allowed=0 WHERE id='user'");
    vi.stubGlobal("fetch",vi.fn());
    await processOutbox(context.env);
    expect(fetch).not.toHaveBeenCalled();
    expect(sqlite.prepare("SELECT status FROM message_outbox").get()?.status).toBe("CANCELLED");
  });
  it("respects Telegram retry_after and terminal blocked-bot errors", async () => {
    sqlite.exec(`INSERT INTO message_outbox(id,event_key,telegram_id,template_key,payload_json) VALUES('message','event','200','DIRECT','{"message":"Привет"}')`);
    const {context}=await requestContext(db,"/");
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json({ok:false,error_code:429,parameters:{retry_after:300}},{status:429})));
    await processOutbox(context.env);
    const retry=sqlite.prepare("SELECT status, attempts, (julianday(next_retry_at)-julianday('now'))*86400 AS seconds FROM message_outbox").get()!;
    expect(retry.status).toBe("PENDING"); expect(Number(retry.seconds)).toBeGreaterThan(295);
    sqlite.exec("UPDATE message_outbox SET next_retry_at=CURRENT_TIMESTAMP; UPDATE telegram_delivery_throttle SET attempted_at=datetime('now','-2 seconds')");
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json({ok:false,error_code:403},{status:403})));
    await processOutbox(context.env);
    expect(sqlite.prepare("SELECT status,last_error FROM message_outbox").get()).toMatchObject({status:"FAILED",last_error:"TELEGRAM_403"});
  });
  it("deduplicates Telegram updates and rejects foreign visit callbacks", async () => {
    seedVisit(sqlite);
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json({ok:true,result:{message_id:1}})));
    const update={update_id:1,callback_query:{id:"callback",data:"confirm:visit",from:{id:300},message:{chat:{id:300,type:"private"}}}};
    for(let attempt=0;attempt<2;attempt++) {
      const {context,background}=await requestContext(db,"/api/telegram/webhook","POST",update);
      context.request.headers.set("x-telegram-bot-api-secret-token","test-secret");
      expect((await webhook(context) as Response).status).toBe(200);
      await Promise.all(background);
    }
    expect(count("telegram_updates")).toBe(1); expect(count("message_outbox")).toBe(1);
    expect(sqlite.prepare("SELECT status FROM appointments WHERE id='visit'").get()?.status).toBe("SCHEDULED");
  });
});
