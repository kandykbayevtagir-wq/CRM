import type { CrmEnv } from '../_lib/env';
import { APP_VERSION } from '../../src/lib/release';

/** Public, bounded diagnostics: never expose users, queue payloads or tokens. */
export const onRequestGet:PagesFunction<CrmEnv>=async({env})=>{
  const headers={'cache-control':'no-store'};
  try {
    const workers=await env.DB.prepare(`SELECT worker_name,status,(julianday('now')-julianday(completed_at))*86400 AS age
      FROM worker_runs WHERE worker_name IN ('notifications','automation')`).all<{worker_name:string;status:string;age:number|null}>();
    const queue=await env.DB.prepare(`SELECT COALESCE(MAX((julianday('now')-julianday(created_at))*86400),0) AS age
      FROM message_outbox WHERE status IN ('PENDING','PROCESSING') AND template_key<>'CAMPAIGN'`).first<{age:number}>();
    const disabled=env.APP_ENV==='staging';
    const background=disabled?'disabled':workers.results?.find(w=>w.worker_name==='notifications' && ['OK','RUNNING'].includes(w.status) && w.age!==null && w.age<300)?'ok':'delayed';
    const automation=disabled?'disabled':workers.results?.find(w=>w.worker_name==='automation' && w.status==='OK' && w.age!==null && w.age<300)?'ok':'delayed';
    const delivery=disabled || (queue?.age ?? 0)<900?'ok':'delayed';
    const ok=background!=='delayed' && automation!=='delayed' && delivery==='ok';
    return Response.json({ok,version:APP_VERSION,schema:'0014',database:'ok',background,automation,delivery,timestamp:new Date().toISOString()},{status:ok?200:503,headers});
  } catch {return Response.json({ok:false,database:'error'},{status:503,headers});}
};
