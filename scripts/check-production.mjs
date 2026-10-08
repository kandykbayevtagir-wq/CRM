import { URL, pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { setTimeout, clearTimeout } from 'node:timers';
/* global AbortController */

export function monitoringOrigin(value) {
  let url;
  try { url=new URL(value); } catch { throw new Error('Invalid monitoring origin'); }
  if (url.protocol!=='https:' || url.username || url.password || url.search || url.hash || url.pathname!=='/') {
    throw new Error('Monitoring requires an HTTPS origin without credentials, query or path');
  }
  return url.origin;
}

function safeDetails(body) {
  const details={};
  if (!body || typeof body!=='object' || Array.isArray(body)) return details;
  for (const key of ['database','background','automation','delivery']) {
    if (['ok','error','delayed','disabled'].includes(body[key])) details[key]=body[key];
  }
  if (typeof body.version==='string' && /^\d+\.\d+\.\d+$/.test(body.version)) details.version=body.version;
  if (typeof body.schema==='string' && /^\d{4}$/.test(body.schema)) details.schema=body.schema;
  return details;
}

export async function probe(origin,path,{fetchImpl=fetch,wait=pause,report=console.log,attempts=3,timeoutMs=15_000}={}) {
  for (let attempt=1;attempt<=attempts;attempt++) {
    const controller=new AbortController(); let timer;
    let result={path,attempt,ok:false,code:'NETWORK_ERROR'};
    try {
      result=await Promise.race([
        (async()=>{
          const response=await fetchImpl(origin+path,{method:'GET',redirect:'manual',cache:'no-store',signal:controller.signal,headers:{accept:'application/json'}});
          let body;
          try { body=await response.json(); } catch { return {path,attempt,ok:false,status:response.status,code:'INVALID_JSON'}; }
          const ok=response.ok && body?.ok===true && body.database==='ok'
            && (path!=='/api/readiness' || ['background','automation','delivery'].every(key=>body[key]==='ok'));
          return {path,attempt,ok,status:response.status,code:ok?'HEALTHY':response.ok?'UNHEALTHY':'HTTP_ERROR',...safeDetails(body)};
        })(),
        new Promise(resolve=>{timer=setTimeout(()=>{
          controller.abort();resolve({path,attempt,ok:false,code:'TIMEOUT'});
        },timeoutMs);}),
      ]);
    } catch { /* Never print raw network errors, response bodies or credentials. */ }
    finally {clearTimeout(timer);}
    report(JSON.stringify(result));
    if(result.ok || attempt===attempts) return result;
    await wait(1000*attempt);
  }
}

export async function checkProduction(origin,options={}) {
  origin=monitoringOrigin(origin);
  const results=[];
  // Inspect both endpoints, even if the first one persistently fails.
  for(const path of ['/api/health','/api/readiness']) results.push(await probe(origin,path,options));
  return {ok:results.every(result=>result.ok),results};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const result=await checkProduction(process.env.CRM_ORIGIN || 'https://podologymk-crm.pages.dev');
    if(!result.ok) {console.error('Production health checks failed; see bounded diagnostics above.');process.exitCode=1;}
  } catch {console.error('Production monitor configuration is invalid.');process.exitCode=1;}
}
