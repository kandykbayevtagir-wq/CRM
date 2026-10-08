import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {URL,URLSearchParams} from 'node:url';
/* global AbortSignal */
const origin=process.env.CRM_E2E_ORIGIN || 'http://127.0.0.1:8790';
const url=new URL(origin);
assert.ok(['localhost','127.0.0.1','podologymk-crm-staging.pages.dev'].includes(url.hostname)
 || /^[a-f0-9]{8}\.podologymk-crm-staging\.pages\.dev$/.test(url.hostname),'E2E must never write to production');
const botToken=process.env.CRM_E2E_TOKEN || 'local-qa-token';
function signedUser(id) {
 const values=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),query_id:randomUUID(),user:JSON.stringify({id,first_name:'QA'})});
 const text=[...values].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');
 const secret=createHmac('sha256','WebAppData').update(botToken).digest();
 values.set('hash',createHmac('sha256',secret).update(text).digest('hex'));return values.toString();
}
async function request(path,{method='GET',body,cookie}={}) {
 const response=await fetch(origin+path,{method,headers:{'content-type':'application/json',origin,...(cookie?{cookie}:{})},
   ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
 assert.ok(response.headers.get('content-type')?.includes('application/json'),`${path} returned non-JSON (${response.status})`);
 const result=await response.json();return {response,result};
}
async function auth(id){const {response,result}=await request('/api/telegram/auth',{method:'POST',body:{initData:signedUser(id)}});
 assert.equal(response.status,200,'real Pages Function Telegram signature authentication: '+(result.code || result.error || ''));
 return response.headers.get('set-cookie').split(';')[0];
}
const health=await request('/api/health');assert.equal(health.response.status,200);assert.equal(health.result.schema,'0014');
const owner=await auth(990000001);const client=await auth(990000002);
assert.equal((await request('/api/finance')).response.status,401);
assert.equal((await request('/api/finance',{cookie:client})).response.status,403);
const key=randomUUID();const expense={title:'Isolated E2E expense',amount:123.45,idempotencyKey:key};
const saved=await request('/api/finance',{method:'POST',body:expense,cookie:owner});assert.equal(saved.response.status,201);
const replay=await request('/api/finance',{method:'POST',body:expense,cookie:owner});
assert.equal(replay.result.id,saved.result.id);assert.equal(replay.result.replayed,true);
const status=await request('/api/mutation-status?'+new URLSearchParams({path:'/api/finance',key}),{cookie:owner});
assert.equal(status.result.state,'COMMITTED');
const date=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
const availability=await request('/api/client/availability?'+new URLSearchParams({date,serviceId:'qa-service',branchId:'qa-branch'}),{cookie:client});
assert.equal(availability.response.status,200);
const slot=availability.result.items[0];assert.ok(slot,'isolated employee schedule generates slots');
const booking={startsAt:slot.startsAt,serviceId:'qa-service',branchId:'qa-branch',employeeId:slot.employeeId,idempotencyKey:randomUUID()};
const visits=await Promise.all([request('/api/client/appointments',{method:'POST',body:booking,cookie:client}),request('/api/client/appointments',{method:'POST',body:{...booking,idempotencyKey:randomUUID()},cookie:client})]);
assert.deepEqual(visits.map(v=>v.response.status).sort(),[201,409],'only one concurrent booking can win');
const winner=visits.find(v=>v.response.status===201);
assert.equal((await request('/api/client/appointments/'+winner.result.id,{method:'PATCH',body:{reason:'E2E cleanup'},cookie:client})).response.status,200);
const reconciliation=await request('/api/reconciliation',{cookie:owner});assert.equal(reconciliation.result.healthy,true);
assert.equal((await request('/api/readiness')).response.status,200);
if(process.env.CRM_E2E_JOBS_ORIGIN) {
 const jobs=new URL(process.env.CRM_E2E_JOBS_ORIGIN);
 assert.ok(['localhost','127.0.0.1'].includes(jobs.hostname),'automation QA must be local-only');
 const joined=await request('/api/client/waitlist',{method:'POST',cookie:client,body:{serviceId:'qa-service',preferredDate:date}});
 assert.equal(joined.response.status,201);
 const offers=await Promise.all([1,2].map(()=>fetch(jobs.origin+'/waitlist',{method:'POST',signal:AbortSignal.timeout(20000)})));
 assert.ok(offers.every(r=>r.ok),'both concurrent automation invocations finish');
 const waiting=await request('/api/client/waitlist',{cookie:client});
 assert.equal(waiting.result.items.length,1);const offer=waiting.result.items[0];
 assert.equal(offer.status,'OFFERED');assert.equal(offer.branchId,'qa-branch');assert.ok(offer.holdId);
 const accept={serviceId:offer.serviceId,branchId:offer.branchId,employeeId:offer.employeeId,startsAt:offer.startsAt,holdId:offer.holdId,idempotencyKey:randomUUID()};
 const accepted=await request('/api/client/appointments',{method:'POST',cookie:client,body:accept});assert.equal(accepted.response.status,201);
 const again=await request('/api/client/appointments',{method:'POST',cookie:client,body:accept});assert.equal(again.result.replayed,true);assert.equal(again.result.id,accepted.result.id);
 assert.equal((await request('/api/client/appointments/'+accepted.result.id,{method:'PATCH',cookie:client,body:{reason:'QA cleanup'}})).response.status,200);
 const explicit=await request('/api/client/waitlist',{method:'POST',cookie:client,body:{serviceId:'qa-service',branchId:'qa-a',preferredDate:date}});
 assert.equal(explicit.response.status,201);
 assert.equal((await fetch(jobs.origin+'/waitlist',{method:'POST',signal:AbortSignal.timeout(20000)})).status,200);
 const noOffer=await request('/api/client/waitlist',{cookie:client});assert.equal(noOffer.result.items[0].status,'ACTIVE');assert.equal(noOffer.result.items[0].holdId,null);
 assert.equal((await request('/api/client/waitlist',{method:'PATCH',cookie:client,body:{id:explicit.result.id,action:'cancel'}})).response.status,200);
 console.log('Real D1 concurrent automation: one any-branch offer in B, atomic acceptance/replay, explicit A not broadened.');
}
console.log('Real Pages Functions / D1 E2E passed: signed auth, permissions, durable receipt, concurrent booking, cancellation, reconciliation, health/readiness.');
