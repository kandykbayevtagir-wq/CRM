import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {DatabaseSync} from 'node:sqlite';
import {seed,seedVisit,seedPayment,testDatabase,requestContext} from './d1';
import {prepareCampaigns,enqueueScheduledTasks} from '../functions/_lib/campaign-jobs';
import {offerWaitlistSlot,expireOffers} from '../functions/_lib/waitlist-jobs';
import {processOutbox} from '../functions/_lib/notification-delivery';
import {reconciliationIssues} from '../functions/_lib/reconciliation';
import {onRequestPost as book} from '../functions/api/client/appointments';
import {onRequestPatch as decline,onRequestPost as join} from '../functions/api/client/waitlist';
import {onRequestPost as expense} from '../functions/api/finance';
import {onRequestGet as mutationStatus} from '../functions/api/mutation-status';
import {onRequestGet as readiness} from '../functions/api/readiness';
import {enqueueDailySummary} from '../functions/_lib/daily-summary';
import type {CrmEnv} from '../functions/_lib/env';
import {errorResponse} from '../functions/_lib/security';
let db:D1Database;let sqlite:DatabaseSync;
beforeEach(()=>{({db,sqlite}=testDatabase());seed(sqlite);});
afterEach(()=>{vi.unstubAllGlobals();sqlite.close();});
async function env(){return (await requestContext(db,'/')).context.env;}
async function call(handler:PagesFunction<CrmEnv>,path:string,method='GET',body?:Record<string,unknown>,user='owner'){
 const {context}=await requestContext(db,path,method,body,user);let response:Response;
 try{response=await handler(context) as Response;}catch(error){response=errorResponse(error,'test');}
 return {status:response.status,body:await response.json() as Record<string,unknown>};
}
const n=(table:string)=>Number(sqlite.prepare('SELECT COUNT(*) AS n FROM '+table).get()?.n);
function campaignRecipients(count:number){
 for(let i=0;i<count;i++) {const id='campaign-client-'+String(i).padStart(3,'0');
 sqlite.prepare("INSERT INTO clients(id,full_name,phone) VALUES(?,?,'')").run(id,id);
 sqlite.prepare("INSERT INTO users(id,telegram_id,name,role,client_id,active,notifications_allowed) VALUES(?, ?, ?, 'CLIENT',?,1,1)").run('u-'+id,String(1000+i),id,id);
 sqlite.prepare("INSERT INTO client_consents(id,client_id,kind,version) VALUES(?,?,'MARKETING','1')").run('c-'+id,id);
 }
 sqlite.exec("INSERT INTO campaigns(id,name,message,status,scheduled_at) VALUES('campaign','Test','Hello','SCHEDULED',datetime('now','-1 minute'))");
}
describe('resumable automation',()=>{
 it('starts scheduled campaigns and commits recipient pages without duplication',async()=>{
  campaignRecipients(85);const e=await env();
  await prepareCampaigns(e);expect(n('campaign_recipients')).toBe(40);
  expect(sqlite.prepare("SELECT preparation_complete AS done FROM campaigns").get()?.done).toBe(0);
  await prepareCampaigns(e);expect(n('campaign_recipients')).toBe(80);
  await prepareCampaigns(e);expect(n('campaign_recipients')).toBe(85);expect(n('message_outbox')).toBe(85);
  await prepareCampaigns(e);expect(n('message_outbox')).toBe(85);
 });
 it('rolls back a failed page and resumes from its original cursor',async()=>{
  campaignRecipients(45);const e=await env();
  sqlite.exec("CREATE TRIGGER injected_failure BEFORE INSERT ON message_outbox BEGIN SELECT RAISE(ABORT,'injected'); END");
  await expect(prepareCampaigns(e)).rejects.toThrow();expect(n('campaign_recipients')).toBe(0);
  sqlite.exec('DROP TRIGGER injected_failure');await prepareCampaigns(e);expect(n('campaign_recipients')).toBe(40);
  await prepareCampaigns(e);expect(n('campaign_recipients')).toBe(45);
 });
 it('deduplicates due follow-ups and tasks and suppresses completed tasks before sending',async()=>{
  sqlite.exec("INSERT INTO follow_ups(id,client_id,recommended_date,assigned_to) VALUES('follow','client',datetime('now','-1 hour'),'owner'); INSERT INTO tasks(id,title,assignee_id,due_date) VALUES('task','Call','owner',datetime('now','-1 hour'))");
  const e=await env();await enqueueScheduledTasks(e);await enqueueScheduledTasks(e);expect(n('message_outbox')).toBe(2);
  sqlite.exec("UPDATE tasks SET status='DONE'");vi.stubGlobal('fetch',vi.fn(async()=>Response.json({ok:true,result:{message_id:1}})));
  await processOutbox(e);expect(sqlite.prepare("SELECT status FROM message_outbox WHERE event_key LIKE 'task-due:%'").get()?.status).toBe('CANCELLED');
 });
 it('never completes a campaign before recipient preparation finishes',async()=>{
  campaignRecipients(41);const e=await env();await prepareCampaigns(e);
  sqlite.exec("UPDATE campaign_recipients SET status='SENT'; UPDATE message_outbox SET status='SENT'");
  await prepareCampaigns(e);expect(sqlite.prepare('SELECT status FROM campaigns').get()?.status).toBe('PROCESSING');
 });
 it('sends the configured owner summary once per local day',async()=>{
  sqlite.exec('UPDATE organization_settings SET daily_summary_enabled=1,daily_summary_hour=0');
  const e=await env();await enqueueDailySummary(e);await enqueueDailySummary(e);expect(n('message_outbox')).toBe(1);
 });
 it('advances beyond the first 100 already enqueued tasks',async()=>{
  for(let i=0;i<105;i++) sqlite.prepare("INSERT INTO tasks(id,title,assignee_id,due_date) VALUES(?, 'Task','owner',datetime('now','-1 hour'))").run('task-'+String(i).padStart(3,'0'));
  const e=await env();await enqueueScheduledTasks(e);expect(n('message_outbox')).toBe(100);
  await enqueueScheduledTasks(e);expect(n('message_outbox')).toBe(105);
 });
 it('suppresses notifications to a former task assignee',async()=>{
  sqlite.exec("INSERT INTO tasks(id,title,assignee_id,due_date) VALUES('task','Private task','owner',datetime('now','-1 hour'))");
  const e=await env();await enqueueScheduledTasks(e);sqlite.exec("UPDATE tasks SET assignee_id='specialist'");
  const send=vi.fn(async()=>Response.json({ok:true,result:{message_id:1}}));vi.stubGlobal('fetch',send);
  await processOutbox(e);expect(send).not.toHaveBeenCalled();expect(sqlite.prepare('SELECT status FROM message_outbox').get()?.status).toBe('CANCELLED');
 });
 it('keeps a delivery batch including expired-lease repair below the Free D1 query budget',async()=>{
  campaignRecipients(3);const e=await env();await prepareCampaigns(e);
  sqlite.exec("INSERT INTO message_outbox(id,event_key,telegram_id,template_key,payload_json,status,attempts,lease_expires_at) VALUES('expired','expired','100','DIRECT','{}','PROCESSING',5,datetime('now','-1 minute'))");
  let queries=0;
  e.DB={...db,prepare(query:string){queries++;return db.prepare(query);}} as D1Database;
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({ok:true,result:{message_id:1}})));
  await processOutbox(e);expect(queries).toBeLessThanOrEqual(50);
  expect(n('message_outbox')).toBe(4);expect(sqlite.prepare("SELECT COUNT(*) AS n FROM message_outbox WHERE status='SENT'").get()?.n).toBe(3);
 });
});
describe('exclusive waitlist offers',()=>{
 async function offer(){const date='2030-01-07';sqlite.exec("INSERT INTO client_waitlist(id,client_id,service_id,branch_id,preferred_date) VALUES('waiting','client','service','branch','"+date+"')");await offerWaitlistSlot(await env());return sqlite.prepare('SELECT * FROM booking_holds').get()!;}
 it('protects the entire offered interval and atomically converts the hold into a booking',async()=>{
  const h=await offer();expect(h).toBeTruthy();
  expect(()=>seedVisit(sqlite,'intruder','SCHEDULED',new Date(Date.parse(String(h.starts_at))+1800000).toISOString())).toThrow('CRM_SLOT_UNAVAILABLE');
  const body={serviceId:'service',branchId:'branch',employeeId:h.employee_id,startsAt:h.starts_at,holdId:h.id,idempotencyKey:'accept-hold'};
  const foreign=await call(book,'/api/client/appointments','POST',body,'other-user');expect(foreign.status).toBe(409);
  const accepted=await call(book,'/api/client/appointments','POST',body,'user');expect(accepted.status).toBe(201);
  const replay=await call(book,'/api/client/appointments','POST',body,'user');expect(replay.body.replayed).toBe(true);
  expect(n('appointments')).toBe(1);expect(sqlite.prepare('SELECT status FROM booking_holds').get()?.status).toBe('CONVERTED');
 });
 it('releases declined offers, moves to another window, and prevents foreign cancellation',async()=>{
  const h=await offer();expect(h).toBeTruthy();
  expect((await call(decline,'/api/client/waitlist','PATCH',{id:'waiting',action:'decline'},'other-user')).status).toBe(403);
  expect((await call(decline,'/api/client/waitlist','PATCH',{id:'waiting',action:'decline'},'user')).status).toBe(200);
  sqlite.exec("UPDATE client_waitlist SET retry_after=NULL");await offerWaitlistSlot(await env());expect(n('booking_holds')).toBe(2);
  expect(sqlite.prepare("SELECT starts_at FROM booking_holds WHERE status='HELD'").get()?.starts_at).not.toBe(h.starts_at);
 });
 it('expires a hold and rejects its acceptance without creating a visit',async()=>{
  const h=await offer();sqlite.exec("UPDATE booking_holds SET expires_at=datetime('now','-1 minute')");await expireOffers(await env());
  const result=await call(book,'/api/client/appointments','POST',{serviceId:'service',branchId:'branch',employeeId:h.employee_id,startsAt:h.starts_at,holdId:h.id},'user');
  expect(result.status).toBe(409);expect(n('appointments')).toBe(0);
 });
 it('does not allow requesting earlier time for another client',async()=>{
  seedVisit(sqlite);expect((await call(join,'/api/client/waitlist','POST',{serviceId:'service',branchId:'branch',appointmentId:'visit'},'other-user')).status).toBe(400);
 });
 it('releases an earlier-time offer if the original appointment is cancelled',async()=>{
  seedVisit(sqlite);
  sqlite.exec("INSERT INTO client_waitlist(id,client_id,service_id,branch_id,preferred_date,appointment_id) VALUES('waiting','client','service','branch','2030-01-05','visit')");
  const e=await env();await offerWaitlistSlot(e);expect(n('booking_holds')).toBe(1);
  sqlite.exec("UPDATE appointments SET status='CANCELLED'");await expireOffers(e);
  expect(sqlite.prepare('SELECT status FROM client_waitlist').get()?.status).toBe('CANCELLED');
  expect(sqlite.prepare('SELECT status FROM booking_holds').get()?.status).toBe('EXPIRED');
 });
});
describe('financial recovery and operational readiness',()=>{
 it('returns only the actors saved receipt and never reports an absent receipt as a failed write',async()=>{
  await call(expense,'/api/finance','POST',{title:'Expense',amount:100,idempotencyKey:'recovery-key'});
  expect((await call(mutationStatus,'/api/mutation-status?path=/api/finance&key=recovery-key')).body.state).toBe('COMMITTED');
  expect((await call(mutationStatus,'/api/mutation-status?path=/api/finance&key=absent')).body.state).toBe('NOT_FOUND');
  expect((await call(mutationStatus,'/api/mutation-status?path=/api/finance&key=recovery-key','GET',undefined,'user')).status).toBe(403);
 });
 it('finds mismatched individual entries even when aggregate amounts and counts match',async()=>{
  seedVisit(sqlite,'a');seedVisit(sqlite,'b','SCHEDULED','2030-01-07T06:00:00Z');
  seedPayment(sqlite,'a',100,'2030-01-07T04:00:00Z');seedPayment(sqlite,'b',200,'2030-01-07T06:00:00Z');
  expect((await reconciliationIssues(db)).issueCount).toBe(0);
  sqlite.exec('DROP TRIGGER posted_ledger_immutable_update');
  sqlite.exec("UPDATE financial_transactions SET amount=CASE payment_id WHEN 'payment-a' THEN 200 ELSE 100 END WHERE kind='PAYMENT'");
  expect((await reconciliationIssues(db)).issueCount).toBe(2);
 });
 it('treats planned expenses as planned and checks paid expenses',async()=>{
  await call(expense,'/api/finance','POST',{title:'Planned',amount:100,status:'PLANNED'});
  await call(expense,'/api/finance','POST',{title:'Paid',amount:200});expect((await reconciliationIssues(db)).issueCount).toBe(0);
 });
 it('reports posted ledger entries without a source reference',async()=>{
  sqlite.exec("INSERT INTO financial_transactions(id,direction,kind,category,amount,status,occurred_at) VALUES('orphan','EXPENSE','RENT','RENT',100,'POSTED',CURRENT_TIMESTAMP)");
  expect((await reconciliationIssues(db)).issues[0].code).toBe('ORPHAN_LEDGER');
 });
 it('exposes background failure without leaking queue contents',async()=>{
  const result=await call(readiness,'/api/readiness');expect(result.status).toBe(503);expect(result.body.background).toBe('delayed');
  sqlite.exec("INSERT INTO worker_runs(worker_name,started_at,completed_at,status) VALUES('notifications',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'OK'),('automation',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'OK')");
  expect((await call(readiness,'/api/readiness')).status).toBe(200);
 });
});
