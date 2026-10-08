/* global AbortSignal */
const origin=process.env.CRM_ORIGIN || 'https://podologymk-crm.pages.dev';
for (const path of ['/api/health','/api/readiness']) {
  let last;
  for (let attempt=0;attempt<3;attempt++) {
    try {
      const response=await fetch(origin+path,{signal:AbortSignal.timeout(15000),cache:'no-store'});
      const status=await response.json();
      if(!response.ok || !status.ok) throw new Error(`${path}: HTTP ${response.status}, ${JSON.stringify(status)}`);
      console.log(`${path}: healthy ${status.version}`);last=null;break;
    } catch(error) {last=error;}
  }
  if(last) throw last;
}
