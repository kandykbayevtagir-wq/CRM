import type { CrmEnv } from '../functions/_lib/env';
import { processOutbox } from '../functions/_lib/notification-delivery';

// Only the private service binding can supply a token. Never log the request body.
export default {
  async fetch(request:Request,env:CrmEnv) {
    if(request.method!=='POST' || new URL(request.url).pathname!=='/drain') return new Response(null,{status:404});
    const body=await request.json() as {token?:unknown};
    if(typeof body.token!=='string' || !body.token) return new Response(null,{status:400});
    const processed=await processOutbox({...env,TELEGRAM_BOT_TOKEN:body.token});
    return Response.json({ok:true,processed});
  },
};
