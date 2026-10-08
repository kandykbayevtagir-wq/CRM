import type { CrmEnv } from '../functions/_lib/env';
import { prepareCampaigns,enqueueScheduledTasks } from '../functions/_lib/campaign-jobs';
import { offerWaitlistSlot } from '../functions/_lib/waitlist-jobs';
import { enqueueDailySummary } from '../functions/_lib/daily-summary';

// Service-binding-only worker: no public URL, no production Telegram secret.
export default {
  async fetch(request:Request,env:CrmEnv) {
    if(request.method!=='POST') return new Response(null,{status:404});
    if(new URL(request.url).pathname==='/schedule') {
      await prepareCampaigns(env);await enqueueScheduledTasks(env);await enqueueDailySummary(env);
    } else if(new URL(request.url).pathname==='/waitlist') await offerWaitlistSlot(env);
    else return new Response(null,{status:404});
    return Response.json({ok:true});
  },
};
