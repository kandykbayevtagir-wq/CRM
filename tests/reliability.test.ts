import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { seed, seedVisit, seedPayment, testDatabase, requestContext } from './d1';
import { offerWaitlistSlot, expireOffers } from '../functions/_lib/waitlist-jobs';
import { processOutbox } from '../functions/_lib/notification-delivery';
import { onRequestPost as book } from '../functions/api/client/appointments';
import { onRequestGet as readiness } from '../functions/api/readiness';
import type { CrmEnv } from '../functions/_lib/env';
import { findAvailableSlots } from '../functions/_lib/availability';

let db: D1Database;
let sqlite: DatabaseSync;
beforeEach(() => { ({ db, sqlite } = testDatabase()); seed(sqlite); });
afterEach(() => { vi.unstubAllGlobals(); sqlite.close(); });
async function env() { return (await requestContext(db, '/')).context.env; }
function waiter(branch: string | null = null, employee: string | null = null, appointment: string | null = null) {
  sqlite.prepare(`INSERT INTO client_waitlist(id,client_id,service_id,branch_id,employee_id,preferred_date,appointment_id)
    VALUES('waiting','client','service',?,?,'2030-01-07',?)`).run(branch, employee, appointment);
}
const hold = () => sqlite.prepare("SELECT * FROM booking_holds WHERE status='HELD'").get();
function race(e: CrmEnv, sql: string | (() => void), match = 'INSERT INTO mutation_guards') {
  const original = e.DB;
  e.DB = { prepare: original.prepare.bind(original), async batch(statements: D1PreparedStatement[]) {
    if (statements.some(s => String((s as unknown as {query: string}).query).includes(match))) {
      e.DB = original; if(typeof sql==='string') sqlite.exec(sql); else sql();
    }
    return original.batch(statements);
  }} as D1Database;
}

describe('branch-agnostic waitlist', () => {
  beforeEach(() => {
    // A sorts first but has no qualified specialist. The service is explicitly B-only.
    sqlite.exec(`INSERT INTO branches(id,name,is_active) VALUES('a','Branch A',1);
      UPDATE employee_services SET branch_id='branch';`);
  });
  it('finds B-only service and specialist instead of falling back to A', async () => {
    waiter(null, 'employee'); await offerWaitlistSlot(await env());
    expect(hold()?.branch_id).toBe('branch'); expect(hold()?.employee_id).toBe('employee');
  });
  it('does not broaden an explicit branch selection', async () => {
    waiter('a'); await offerWaitlistSlot(await env()); expect(hold()).toBeUndefined();
    expect(sqlite.prepare('SELECT status FROM client_waitlist').get()?.status).toBe('ACTIVE');
  });
  it('does not let a closure in A hide valid slots in B, and resolves ties by IDs', async () => {
    sqlite.exec(`INSERT INTO employee_branches(employee_id,branch_id) VALUES('employee','a');
      UPDATE employee_services SET branch_id=NULL;
      INSERT INTO branch_closures(id,branch_id,starts_at,ends_at,reason)
      VALUES('closed','a','2030-01-07T00:00:00Z','2030-01-08T00:00:00Z','closed');`);
    waiter(); await offerWaitlistSlot(await env()); expect(hold()?.branch_id).toBe('branch');
  });
  it('skips an archived first branch', async () => {
    sqlite.exec("UPDATE branches SET is_active=0 WHERE id='a'");
    waiter(); await offerWaitlistSlot(await env()); expect(hold()?.branch_id).toBe('branch');
  });
  it('never offers an archived explicitly requested specialist', async () => {
    sqlite.exec("UPDATE employees SET is_active=0 WHERE id='employee'");
    waiter(null, 'employee'); await offerWaitlistSlot(await env());
    expect(hold()).toBeUndefined(); expect(sqlite.prepare('SELECT status FROM client_waitlist').get()?.status).toBe('EXPIRED');
  });
  it('expires an explicit archived branch rather than substituting B', async () => {
    sqlite.exec("UPDATE branches SET is_active=0 WHERE id='a'"); waiter('a'); await offerWaitlistSlot(await env());
    expect(hold()).toBeUndefined();expect(sqlite.prepare('SELECT status FROM client_waitlist').get()?.status).toBe('EXPIRED');
  });
  it('selects equally early eligible branches deterministically by branch ID', async () => {
    sqlite.exec("INSERT INTO employee_branches(employee_id,branch_id) VALUES('employee','a'); UPDATE employee_services SET branch_id=NULL");
    waiter();await offerWaitlistSlot(await env());expect(hold()?.branch_id).toBe('a');
  });
  it('uses bounded queries and parameter counts with over 100 qualified specialists', async () => {
    for(let i=0;i<105;i++) {
      const id='many-'+i;
      sqlite.prepare("INSERT INTO employees(id,full_name,position,is_active) VALUES(?, ?,'Specialist',1)").run(id,id);
      sqlite.prepare("INSERT INTO employee_branches(employee_id,branch_id) VALUES(?,'branch')").run(id);
      sqlite.prepare("INSERT INTO employee_services(id,employee_id,service_id,branch_id) VALUES(?,?,'service','branch')").run(id,id);
      sqlite.prepare("INSERT INTO employee_schedules(id,employee_id,day_of_week,starts_time,ends_time,is_active) VALUES(?,?,1,'09:00','18:00',1)").run(id,id);
    }
    let queries=0;
    const bounded={prepare(query:string) {queries++;const statement=db.prepare(query);return {
      bind(...values:unknown[]) {expect(values.length).toBeLessThanOrEqual(100);return statement.bind(...values);},
      first:statement.first.bind(statement),all:statement.all.bind(statement),run:statement.run.bind(statement),
    };}} as unknown as D1Database;
    expect((await findAvailableSlots(bounded,{date:'2030-01-07',serviceId:'service'})).length).toBeGreaterThan(0);
    expect(queries).toBeLessThanOrEqual(10);
  });
  it('respects schedules, time off, appointments and active holds in B', async () => {
    seedVisit(sqlite, 'busy', 'SCHEDULED', '2030-01-07T04:00:00.000Z');
    sqlite.exec(`INSERT INTO employee_time_off(id,employee_id,starts_at,ends_at,reason)
      VALUES('off','employee','2030-01-07T05:00:00Z','2030-01-07T07:00:00Z','off');`);
    waiter(null, 'employee'); const e = await env(); await offerWaitlistSlot(e);
    expect(Date.parse(String(hold()?.starts_at))).toBeGreaterThanOrEqual(Date.parse('2030-01-07T07:00:00Z'));
    const first = hold();
    sqlite.exec(`INSERT INTO client_waitlist(id,client_id,service_id,preferred_date)
      VALUES('second','other-client','service','2030-01-07');`);
    await offerWaitlistSlot(e);
    const second = sqlite.prepare("SELECT * FROM booking_holds WHERE waitlist_id='second'").get();
    expect(Date.parse(String(second?.starts_at))).toBeGreaterThanOrEqual(Date.parse(String(first?.ends_at)));
  });
});

describe('waitlist races and stale resources', () => {
  it.each(['services','branches','employees'])('rejects concurrent archival of %s before offer commit',async table=>{
    waiter('branch');const e=await env();race(e,'UPDATE '+table+' SET is_active=0');await offerWaitlistSlot(e);
    expect(hold()).toBeUndefined();expect(sqlite.prepare('SELECT COUNT(*) AS n FROM message_outbox').get()?.n).toBe(0);
  });
  it('rolls back an offer if the client is archived after availability', async () => {
    waiter('branch'); const e = await env(); race(e, "UPDATE clients SET is_active=0 WHERE id='client'");
    await offerWaitlistSlot(e); expect(hold()).toBeUndefined();
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM message_outbox').get()?.n).toBe(0);
    await expireOffers(e); expect(sqlite.prepare('SELECT status FROM client_waitlist').get()?.status).toBe('EXPIRED');
  });
  it('rolls back an offer if the specialist service assignment is removed during scanning', async () => {
    waiter('branch'); const e = await env(); race(e, "UPDATE employee_services SET active=0 WHERE employee_id='employee'");
    await offerWaitlistSlot(e); expect(hold()).toBeUndefined();
  });
  it('does not duplicate offers across repeated automation invocations', async () => {
    waiter('branch'); const e = await env(); await offerWaitlistSlot(e); await offerWaitlistSlot(e);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM booking_holds').get()?.n).toBe(1);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM message_outbox').get()?.n).toBe(1);
  });
  it('lets a concurrent hold win without duplicating or crashing the offer transaction',async()=>{
    waiter('branch');const e=await env();race(e,`INSERT INTO client_waitlist(id,client_id,service_id,status) VALUES('other','other-client','service','OFFERED');
      INSERT INTO booking_holds(id,client_id,service_id,branch_id,employee_id,starts_at,ends_at,expires_at,waitlist_id)
      VALUES('competing','other-client','service','branch','employee','2030-01-07T04:00:00Z','2030-01-07T05:00:00Z',datetime('now','+10 minutes'),'other');`);
    await offerWaitlistSlot(e);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM booking_holds').get()?.n).toBe(1);
    expect(sqlite.prepare("SELECT status FROM client_waitlist WHERE id='waiting'").get()?.status).toBe('ACTIVE');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM message_outbox').get()?.n).toBe(0);
  });
  it('delivers a still-valid offer (eligibility must not suppress all messages)',async()=>{
    waiter('branch');const e=await env();await offerWaitlistSlot(e);
    const send=vi.fn(async()=>Response.json({ok:true,result:{message_id:1}}));vi.stubGlobal('fetch',send);
    await processOutbox(e);expect(send).toHaveBeenCalledTimes(1);expect(sqlite.prepare('SELECT status FROM message_outbox').get()?.status).toBe('SENT');
  });
  it.each([
    "UPDATE clients SET is_active=0 WHERE id='client'",
    "UPDATE services SET is_active=0 WHERE id='service'",
    "UPDATE branches SET is_active=0 WHERE id='branch'",
    "UPDATE employees SET is_active=0 WHERE id='employee'",
    "DELETE FROM employee_branches WHERE employee_id='employee'",
    "UPDATE employee_services SET active=0 WHERE employee_id='employee'",
    "UPDATE booking_holds SET expires_at=datetime('now','-1 minute')",
    "UPDATE employee_schedules SET is_active=0 WHERE employee_id='employee' AND day_of_week=1",
    "INSERT INTO branch_closures(id,branch_id,starts_at,ends_at,reason) VALUES('new-closure','branch','2030-01-07T00:00:00Z','2030-01-08T00:00:00Z','closed')",
  ])('suppresses stale Telegram offers immediately: %s', async sql => {
    waiter('branch'); const e = await env(); await offerWaitlistSlot(e); expect(hold()).toBeTruthy();
    sqlite.exec(sql); const send = vi.fn(async () => Response.json({ok:true,result:{message_id:1}})); vi.stubGlobal('fetch',send);
    await processOutbox(e); expect(send).not.toHaveBeenCalled();
    expect(sqlite.prepare('SELECT status FROM message_outbox').get()?.status).toBe('CANCELLED');
    await expireOffers(e); expect(hold()).toBeUndefined();
    expect(sqlite.prepare('SELECT status FROM client_waitlist').get()?.status).not.toBe('OFFERED');
  });
  it.each(['cancelled','paid'])('suppresses and releases an earlier-time offer when the original is %s',async mode=>{
    seedVisit(sqlite,'original','SCHEDULED','2030-01-09T04:00:00Z');waiter('branch',null,'original');
    const e=await env();await offerWaitlistSlot(e);expect(hold()).toBeTruthy();
    if(mode==='paid') seedPayment(sqlite,'original',10000,new Date().toISOString());
    else sqlite.exec("UPDATE appointments SET status='CANCELLED' WHERE id='original'");
    const send=vi.fn(async()=>Response.json({ok:true,result:{message_id:1}}));vi.stubGlobal('fetch',send);
    await processOutbox(e);expect(send).not.toHaveBeenCalled();await expireOffers(e);expect(hold()).toBeUndefined();
    expect(sqlite.prepare('SELECT status FROM client_waitlist').get()?.status).toBe('CANCELLED');
  });
  it('rejects concurrent payment of the original during offer scanning',async()=>{
    seedVisit(sqlite,'original','SCHEDULED','2030-01-09T04:00:00Z');waiter('branch',null,'original');const e=await env();
    race(e,()=>seedPayment(sqlite,'original',10000,new Date().toISOString()));await offerWaitlistSlot(e);expect(hold()).toBeUndefined();
  });
  it('rejects concurrent payment during reschedule without moving the original',async()=>{
    seedVisit(sqlite,'original','SCHEDULED','2030-01-09T04:00:00Z');
    const {context}=await requestContext(db,'/api/client/appointments','POST',{appointmentId:'original',serviceId:'service',branchId:'branch',employeeId:'employee',startsAt:'2030-01-07T04:00:00.000Z'},'user');
    race(context.env,()=>seedPayment(sqlite,'original',10000,new Date().toISOString()),'UPDATE appointments SET employee_id');
    expect((await book(context) as Response).status).toBe(409);
    expect(sqlite.prepare("SELECT starts_at FROM appointments WHERE id='original'").get()?.starts_at).toBe('2030-01-09T04:00:00Z');
  });
  it('rejects booking if a branch is archived immediately before the atomic write', async () => {
    const {context} = await requestContext(db,'/api/client/appointments','POST',{
      branchId:'branch',serviceId:'service',employeeId:'employee',startsAt:'2030-01-07T04:00:00.000Z'
    },'user');
    race(context.env,"UPDATE branches SET is_active=0 WHERE id='branch'",'INSERT INTO appointments');
    const response = await book(context) as Response; expect(response.status).toBe(409);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM appointments').get()?.n).toBe(0);
  });
});

describe('truthful readiness', () => {
  it('fails for a RUNNING worker with an expired lease despite a recent previous completion', async () => {
    sqlite.exec(`INSERT INTO worker_runs(worker_name,status,started_at,completed_at,lease_expires_at)
      VALUES('notifications','RUNNING',datetime('now','-3 minutes'),datetime('now','-2 minutes'),datetime('now','-1 minute')),
      ('automation','OK',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,NULL);`);
    const {context} = await requestContext(db,'/api/readiness');
    const response = await readiness(context) as Response; expect(response.status).toBe(503);
  });
});
