import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from '../../../_lib/auth';
import type { CrmEnv } from '../../../_lib/env';
import { badRequest, json, notFound } from '../../../_lib/http';

export const onRequestPost: PagesFunction<CrmEnv> = async ({request,env,params}) => {
  const user=await getSessionUser(request,env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user,'campaigns.write')) return forbidden();
  const id=Array.isArray(params.id)?params.id[0]:params.id;
  const campaign=await env.DB.prepare('SELECT status,scheduled_at AS scheduledAt FROM campaigns WHERE id=?').bind(id).first<{status:string;scheduledAt:string|null}>();
  if (!campaign) return notFound('Кампания не найдена');
  if (['PROCESSING','COMPLETED'].includes(campaign.status)) return json({ok:true,replayed:true,status:campaign.status});
  if (!['DRAFT','SCHEDULED'].includes(campaign.status)) return badRequest('Кампания отменена');
  if (campaign.scheduledAt && Date.parse(campaign.scheduledAt)>Date.now()) return badRequest('Кампания ещё не наступила по расписанию');
  const changed=await env.DB.prepare(`UPDATE campaigns SET status='PROCESSING',preparation_complete=0,preparation_cursor='',
    started_at=CURRENT_TIMESTAMP,recipient_count=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('DRAFT','SCHEDULED') RETURNING id`).bind(id).first();
  if(!changed) {
    const current=await env.DB.prepare('SELECT status FROM campaigns WHERE id=?').bind(id).first<{status:string}>();
    if(current && ['PROCESSING','COMPLETED'].includes(current.status)) return json({ok:true,replayed:true,status:current.status});
    return json({ok:false,error:'Кампания была отменена. Обновите список.'},409);
  }
  return json({ok:true,status:'PROCESSING',queued:true},202);
};
