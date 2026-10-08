import { forbidden,getSessionUser,hasCrmPermission,unauthorized } from '../_lib/auth';
import type { CrmEnv } from '../_lib/env';
import { badRequest,json } from '../_lib/http';
import type { Permission } from '../../src/lib/permissions';

const operations:Record<string,{permission:Permission;operation:string}>= {
  '/api/finance':{permission:'finance.write',operation:'expense:create'},
  '/api/rent':{permission:'finance.write',operation:'rent:create'},
  '/api/utilities':{permission:'finance.write',operation:'utility:create'},
  '/api/payroll/adjustment':{permission:'payroll.write',operation:'payroll:adjustment'},
  '/api/payments':{permission:'payments.write',operation:'payment:create'},
  '/api/payments/refund':{permission:'payments.write',operation:'payment:refund'},
};
export const onRequestGet:PagesFunction<CrmEnv>=async({request,env})=>{
  const user=await getSessionUser(request,env.DB);
  if (!user) return unauthorized();
  const params=new URL(request.url).searchParams; const path=params.get('path') || ''; const key=params.get('key') || '';
  const operation=operations[path];
  if (!operation || !key || key.length>128) return badRequest('Некорректная операция');
  if (!hasCrmPermission(user,operation.permission)) return forbidden();
  let result:unknown=null;
  if (path==='/api/payments' || path==='/api/payments/refund') {
    const refund=path.endsWith('/refund');
    const row=await env.DB.prepare(`SELECT ${refund?'adjustment_id':'payment_id'} AS id FROM ${refund?'refund':'payment'}_idempotency_keys WHERE idempotency_key=? AND user_id=?`).bind(key,user.id).first<{id:string}>();
    if (row) result={ok:true,id:row.id};
  } else {
    const row=await env.DB.prepare('SELECT response_json AS response FROM mutation_receipts WHERE actor_id=? AND operation=? AND idempotency_key=?').bind(user.id,operation.operation,key).first<{response:string}>();
    if (row) result=JSON.parse(row.response);
  }
  return json({ok:true,state:result?'COMMITTED':'NOT_FOUND',result});
};
