import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import type {DatabaseSync} from 'node:sqlite';
import {seed,testDatabase,requestContext} from './d1';
import {runNotifications} from '../workers/notifications';
import {privateService} from '../workers/private-service';
import {APP_VERSION} from '../src/lib/release';
import {onRequestGet as readiness} from '../functions/api/readiness';
let db:D1Database;let sqlite:DatabaseSync;
beforeEach(()=>{({db,sqlite}=testDatabase());seed(sqlite);vi.spyOn(console,'error').mockImplementation(()=>{});});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();sqlite.close();});
async function env(){const e=(await requestContext(db,'/')).context.env;
 sqlite.prepare("INSERT INTO worker_runs(worker_name,status,started_at,completed_at) VALUES(?,'OK',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run('telegram-config-'+APP_VERSION);return e;}
const binding=(fetch:unknown)=>({fetch} as Fetcher);
describe('private worker failures',()=>{
 it('bounds a service that never responds and aborts its signal',async()=>{
  let signal:AbortSignal|undefined;
  const service=binding((_url:string,init:RequestInit)=>{signal=init.signal ?? undefined;return new Promise(()=>{});});
  await expect(privateService(service,'/waitlist',{method:'POST'},async()=>{},5)).rejects.toThrow('PRIVATE_SERVICE_TIMEOUT');
  expect(signal?.aborted).toBe(true);
 });
 it('bounds a response body that never completes',async()=>{
  const service=binding(async()=>({json:()=>new Promise(()=>{})}));
  await expect(privateService(service,'/drain',{method:'POST'},r=>r.json(),5)).rejects.toThrow('PRIVATE_SERVICE_TIMEOUT');
 });
 it('records automation failure but continues independent delivery',async()=>{
  const e=await env();e.JOBS=binding(async()=>new Response(null,{status:503}));
  const delivery=vi.fn(async()=>Response.json({processed:0}));e.DELIVERY=binding(delivery);
  await runNotifications(e);expect(delivery).toHaveBeenCalledTimes(1);
  expect(sqlite.prepare("SELECT status FROM worker_runs WHERE worker_name='automation'").get()?.status).toBe('FAILED');
  expect(sqlite.prepare("SELECT status FROM worker_runs WHERE worker_name='notifications'").get()?.status).toBe('OK');
  const {context}=await requestContext(db,'/api/readiness');expect((await readiness(context) as Response).status).toBe(503);
 });
 it('records delivery failure, releases the lease and fails readiness',async()=>{
  const e=await env();e.JOBS=binding(async()=>Response.json({ok:true}));e.DELIVERY=binding(async()=>new Response(null,{status:503}));
  await expect(runNotifications(e)).rejects.toThrow('Notification worker failed');
  expect(sqlite.prepare("SELECT status,lease_token FROM worker_runs WHERE worker_name='notifications'").get()).toMatchObject({status:'FAILED',lease_token:null});
 });
 it('does not let a stale invocation deliver or overwrite its successor lease',async()=>{
  const e=await env();e.JOBS=binding(async()=>{
    sqlite.exec("UPDATE worker_runs SET lease_token='successor',lease_expires_at=datetime('now','+2 minutes') WHERE worker_name='notifications'");return Response.json({ok:true});
  });
  const delivery=vi.fn(async()=>Response.json({processed:0}));e.DELIVERY=binding(delivery);
  await expect(runNotifications(e)).rejects.toThrow();expect(delivery).not.toHaveBeenCalled();
  expect(sqlite.prepare("SELECT status,lease_token FROM worker_runs WHERE worker_name='notifications'").get()).toMatchObject({status:'RUNNING',lease_token:'successor'});
 });
 it('reports bounded public diagnostics when D1 fails',async()=>{
  const {context}=await requestContext(db,'/api/readiness');
  context.env.DB={prepare(){throw new Error('sensitive database details');}} as unknown as D1Database;
  const response=await readiness(context) as Response;expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ok:false,database:'error'});
 });
 it('safely rejects malformed delivery counts',async()=>{
  const e=await env();e.JOBS=binding(async()=>Response.json({ok:true}));e.DELIVERY=binding(async()=>Response.json({processed:'secret'}));
  await expect(runNotifications(e)).rejects.toThrow('Notification worker failed');
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('secret');
 });
});
