import {beforeEach,afterEach,describe,it,expect} from 'vitest';
import type {DatabaseSync} from 'node:sqlite';
import {seed,testDatabase,requestContext} from './d1';
import type {CrmEnv} from '../functions/_lib/env';
import * as payments from '../functions/api/payments';
import * as refunds from '../functions/api/payments/refund';
import * as payroll from '../functions/api/payroll';
import * as closePayroll from '../functions/api/payroll/close';
import * as expenses from '../functions/api/finance';
import * as inventory from '../functions/api/inventory';
import * as issues from '../functions/api/inventory/issues';
import * as purchases from '../functions/api/purchases';
import * as receive from '../functions/api/purchases/[id]/receive';
import * as exports from '../functions/api/export';
import * as reports from '../functions/api/reports';
import * as audit from '../functions/api/audit';
import * as campaigns from '../functions/api/campaigns';
import * as operations from '../functions/api/operations';
import * as recovery from '../functions/api/mutation-status';
import * as clients from '../functions/api/clients';
import * as appointments from '../functions/api/appointments';
let db:D1Database;let sqlite:DatabaseSync;
beforeEach(()=>{({db,sqlite}=testDatabase());seed(sqlite);});
afterEach(()=>sqlite.close());
const cases:[string,string,PagesFunction<CrmEnv>][]=[
 ['/api/payments','GET',payments.onRequestGet],['/api/payments','POST',payments.onRequestPost],
 ['/api/payments/refund','POST',refunds.onRequestPost],['/api/payroll','GET',payroll.onRequestGet],
 ['/api/payroll/close','POST',closePayroll.onRequestPost],['/api/finance','POST',expenses.onRequestPost],
 ['/api/inventory','GET',inventory.onRequestGet],['/api/inventory/issues','PATCH',issues.onRequestPatch],
 ['/api/purchases','GET',purchases.onRequestGet],['/api/purchases/id/receive','POST',receive.onRequestPost],
 ['/api/export?type=clients','GET',exports.onRequestGet],['/api/reports','GET',reports.onRequestGet],
 ['/api/audit','GET',audit.onRequestGet],['/api/campaigns','POST',campaigns.onRequestPost],
 ['/api/operations','POST',operations.onRequestPost],['/api/mutation-status?path=/api/finance&key=other','GET',recovery.onRequestGet],
 ['/api/clients','GET',clients.onRequestGet],['/api/appointments','POST',appointments.onRequestPost],
];
describe('sensitive API permission regressions',()=>{
 it.each(cases)('rejects CLIENT and anonymous callers: %s %s',async(path,method,handler)=>{
  const {context}=await requestContext(db,path,method,method==='GET'?undefined:{},'user',{id:'id'});
  expect((await handler(context) as Response).status).toBe(403);
  context.request=new Request('https://crm.test'+path,{method,headers:{'content-type':'application/json'},...(method==='GET'?{}:{body:'{}'})}) as typeof context.request;
  expect((await handler(context) as Response).status).toBe(401);
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM audit_logs').get()?.n).toBe(0);
 });
});
