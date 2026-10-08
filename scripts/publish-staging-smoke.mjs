// Explicit staging-only release check. Uses an ephemeral synthetic signing key, not a live Telegram bot.
import {mkdtempSync,symlinkSync,cpSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
/* global AbortSignal */
const root=process.cwd();
if(process.env.CRM_STAGING_QA_SETUP!=='1') throw new Error('Explicit CRM_STAGING_QA_SETUP=1 is required to replace the isolated QA signing key');
const dir=mkdtempSync(resolve('.wrangler/staging-publish-'));
// Real files avoid Wrangler's path normalization bug when compiling symlinked Functions.
for(const name of ['functions','src','out']) cpSync(resolve(name),resolve(dir,name),{recursive:true,filter:path=>!path.includes('/src/generated')});
for(const name of ['package.json','node_modules']) symlinkSync(resolve(name),resolve(dir,name));
writeFileSync(resolve(dir,'wrangler.jsonc'),readFileSync(resolve('wrangler.staging.jsonc')));
const token=randomBytes(32).toString('hex');
const locate=spawnSync('npm',['exec','--yes','--package=wrangler@4.148.0','--','which','wrangler'],{cwd:root,encoding:'utf8'});
if(locate.status!==0) throw new Error('Cannot locate pinned Wrangler');
const wrangler=locate.stdout.trim();
function command(args,input,cwd=root) {
 const result=spawnSync(wrangler,args,{cwd,encoding:'utf8',input,stdio:['pipe','pipe','pipe']});
 if(result.status!==0) throw new Error(result.stderr || result.stdout || 'Wrangler failed');
 console.log(result.stdout);
 return result.stdout;
}
command(['pages','secret','bulk','--project-name','podologymk-crm-staging'],JSON.stringify({
 TELEGRAM_BOT_TOKEN:token,TELEGRAM_WEBHOOK_SECRET:randomBytes(32).toString('hex'),CRM_OWNER_TELEGRAM_ID:'990000001',CRM_ALLOWED_TELEGRAM_IDS:'990000001'
}));
const deployment=command(['pages','deploy','out','--project-name','podologymk-crm-staging','--branch','main','--commit-dirty=true'],undefined,dir);
const origin=deployment.match(/https:\/\/[a-f0-9]{8}\.podologymk-crm-staging\.pages\.dev/)?.[0];
if(!origin) throw new Error('Missing isolated staging deployment URL');
// Check the exact deployment, avoiding the stable alias's propagation window.
let ready=false;
for(let attempt=0;attempt<30;attempt++) {
 try {
  const response=await fetch(origin+'/api/health',{cache:'no-store',signal:AbortSignal.timeout(10000)});
  const health=await response.json();
  if(response.ok && health.version==='0.9.0' && health.schema==='0014') {
   const routes=['/api/auth/me','/api/finance','/api/mutation-status','/api/client/availability','/api/client/appointments','/api/reconciliation'];
   let routed=true;
   for(const path of routes) {
    const probe=await fetch(origin+path,{cache:'no-store',signal:AbortSignal.timeout(10000)});
    await probe.text();
    if(probe.status!==401) {routed=false;break;}
   }
   if(routed) {ready=true;break;}
  }
 } catch { /* Retry propagation and temporary network errors, not the mutation checks. */ }
 await delay(1000);
}
if(!ready) throw new Error('Staging health did not become ready after deployment');
const result=spawnSync(process.execPath,['scripts/api-e2e.mjs'],{cwd:root,env:{...process.env,CRM_E2E_ORIGIN:origin,CRM_E2E_TOKEN:token},stdio:'inherit'});
if(result.status!==0) throw new Error('Remote staging E2E failed');
