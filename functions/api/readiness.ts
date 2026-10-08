import type { CrmEnv } from '../_lib/env';
import { APP_VERSION } from '../../src/lib/release';

/** Public, bounded diagnostics: never expose users, queue payloads or tokens. */
export const onRequestGet:PagesFunction<CrmEnv>=async({env})=>{
  const headers={'cache-control':'no-store'};
  try {
    const workers=await env.DB.prepare(`SELECT worker_name,status,(julianday('now')-julianday(completed_at))*86400 AS age,
      (julianday('now')-julianday(started_at))*86400 AS startedAge,
      CASE WHEN lease_token IS NOT NULL AND julianday(lease_expires_at)>julianday('now') THEN 1 ELSE 0 END AS leased
      FROM worker_runs WHERE worker_name IN ('notifications','automation')`).all<{worker_name:string;status:string;age:number|null;startedAge:number|null;leased:number}>();
    const queue=await env.DB.prepare(`SELECT COALESCE(MAX((julianday('now')-julianday(created_at))*86400),0) AS age
      FROM message_outbox WHERE status IN ('PENDING','PROCESSING') AND template_key<>'CAMPAIGN'`).first<{age:number}>();
    const disabled=env.APP_ENV==='staging';
    const recent = (age: number | null, limit: number) => age!==null && age>=0 && age<limit;
    const background=disabled?'disabled':workers.results?.find(w=>w.worker_name==='notifications' &&
      (w.status==='OK' && recent(w.age,300) || w.status==='RUNNING' && w.leased===1 && recent(w.startedAge,120)))?'ok':'delayed';
    const automation=disabled?'disabled':workers.results?.find(w=>w.worker_name==='automation' && w.status==='OK' && recent(w.age,300))?'ok':'delayed';
    const delivery=disabled || (queue?.age ?? 0)<900?'ok':'delayed';
    const ok=background!=='delayed' && automation!=='delayed' && delivery==='ok';
    return Response.json({ok,version:APP_VERSION,schema:'0014',database:'ok',background,automation,delivery,timestamp:new Date().toISOString()},{status:ok?200:503,headers});
  } catch {return Response.json({ok:false,database:'error'},{status:503,headers});}
};
