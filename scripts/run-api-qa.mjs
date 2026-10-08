import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,symlink,open} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
/* global AbortSignal */

// Fresh, local-only D1. Never applies migrations or fixtures remotely.
const root=resolve('.');
await mkdir(join(root,'.wrangler'),{recursive:true});
const temporary=await mkdtemp(join(root,'.wrangler','api-qa-'));
const pages=join(temporary,'pages');
const persist=join(temporary,'data');
await mkdir(pages);
const children=[];
const handles=[];
const environment={...process.env,WRANGLER_SEND_METRICS:'false'};
const wrangler=join(root,'node_modules/wrangler/bin/wrangler.js');
const config=JSON.parse(await readFile(join(root,'wrangler.staging.jsonc'),'utf8'));
config.vars.MINI_APP_URL='http://127.0.0.1:8790';
config.d1_databases[0].migrations_dir=join(root,'migrations');
await writeFile(join(pages,'wrangler.jsonc'),JSON.stringify(config));
for(const name of ['functions','src','out','package.json','node_modules']) await symlink(join(root,name),join(pages,name));
const jobs={name:'crm-local-automation-qa',main:join(root,'workers/automation.ts'),compatibility_date:config.compatibility_date,
  workers_dev:false,preview_urls:false,vars:config.vars,d1_databases:config.d1_databases};
const jobsConfig=join(temporary,'automation.json');
await writeFile(jobsConfig,JSON.stringify(jobs));

function command(args,options={}) {
  const child=spawn(process.execPath,args,{cwd:root,env:environment,stdio:'inherit',...options});
  const complete=new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('exit',(code,signal)=>code===0?resolve():reject(new Error('QA subprocess failed: '+(code ?? signal))));
  });
  return {child,complete};
}
async function start(name,args) {
  const handle=await open(join(temporary,name+'.log'),'a');handles.push(handle);
  const {child,complete}=command([wrangler,...args],{stdio:['ignore',handle.fd,handle.fd]});
  children.push(child);complete.catch(()=>{});return child;
}
async function recorded(name,args) {
  const handle=await open(join(temporary,name+'.log'),'a');handles.push(handle);
  await command([wrangler,...args],{stdio:['ignore',handle.fd,handle.fd]}).complete;
  console.log('Local QA '+name+': passed');
}
async function ready(url,status=200) {
  const deadline=Date.now()+45_000;
  while(Date.now()<deadline) {
    if(children.some(child=>child.exitCode!==null || child.signalCode!==null)) throw new Error('Local QA runtime exited');
    try { if((await fetch(url,{signal:AbortSignal.timeout(1000)})).status===status) return; } catch { /* Startup only. */ }
    await pause(250);
  }
  throw new Error('Local QA runtime did not become ready');
}
async function stop() {
  for(const child of children) child.kill('SIGTERM');
  await pause(300);
  for(const child of children) if(child.exitCode===null && child.signalCode===null) child.kill('SIGKILL');
  await Promise.all(handles.map(handle=>handle.close()));
}
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{stop().finally(()=>process.exit(1));});
try {
  await recorded('migrations',['d1','migrations','apply','podologymk_crm_staging','--local','--config',join(pages,'wrangler.jsonc'),'--persist-to',persist]);
  await recorded('fixture',['d1','execute','podologymk_crm_staging','--local','--config',join(pages,'wrangler.jsonc'),'--persist-to',persist,'--file',join(root,'scripts/staging-fixture.sql')]);
  await start('pages',['--cwd',pages,'pages','dev','out','--ip','127.0.0.1','--port','8790','--persist-to',persist,
    '--binding','TELEGRAM_BOT_TOKEN=local-qa-token','--binding','CRM_OWNER_TELEGRAM_ID=990000001',
    '--binding','CRM_ALLOWED_TELEGRAM_IDS=990000001','--binding','TELEGRAM_WEBHOOK_SECRET=local-qa-webhook']);
  await start('automation',['dev','--config',jobsConfig,'--ip','127.0.0.1','--port','8791','--persist-to',persist]);
  await ready('http://127.0.0.1:8790/api/health');
  await ready('http://127.0.0.1:8791/schedule',404);
  await command([join(root,'scripts/api-e2e.mjs')],{env:{...environment,CRM_E2E_ORIGIN:'http://127.0.0.1:8790',
    CRM_E2E_JOBS_ORIGIN:'http://127.0.0.1:8791',CRM_E2E_TOKEN:'local-qa-token'}}).complete;
  console.log('Fresh local D1 migration chain and real Pages + automation worker QA passed.');
} catch(error) {
  console.error(error.message);
  console.error('Synthetic local runtime logs: '+temporary);
  process.exitCode=1;
} finally {await stop();}
