import type { CrmEnv } from './env';
import { localDate,localDayRange } from '../../src/lib/appointments/schedule';

export async function enqueueDailySummary(env:CrmEnv) {
  const settings=await env.DB.prepare('SELECT timezone,daily_summary_enabled AS enabled,daily_summary_hour AS hour FROM organization_settings WHERE id=1').first<{timezone:string;enabled:number;hour:number}>();
  if (!settings?.enabled) return;
  const now=new Date(); const timezone=settings.timezone; const date=localDate(now,timezone);
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',hourCycle:'h23'}).format(now));
  if(hour<settings.hour) return;
  const {from,to}=localDayRange(date,timezone);
  const counts=await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM appointments WHERE julianday(starts_at)>=julianday(?) AND julianday(starts_at)<julianday(?) AND status NOT IN ('CANCELLED','NO_SHOW')) AS visits,
    (SELECT COUNT(*) FROM tasks WHERE status IN ('OPEN','IN_PROGRESS') AND julianday(due_date)<=julianday('now')) AS tasks,
    (SELECT COUNT(*) FROM follow_ups WHERE status='OPEN' AND julianday(recommended_date)<=julianday('now')) AS followUps,
    (SELECT COUNT(*) FROM message_outbox WHERE status='FAILED') AS failures`).bind(from,to).first<{visits:number;tasks:number;followUps:number;failures:number}>();
  await env.DB.prepare(`INSERT OR IGNORE INTO message_outbox(id,event_key,telegram_id,template_key,payload_json)
    SELECT lower(hex(randomblob(16))), 'daily-summary:'||?||':'||id,telegram_id,'DIRECT',
      json_object('userId',id,'requiredPermission','appointments.manage_all','respectNotifications',1,'message',?,
        'replyMarkup',json_object('inline_keyboard',json_array(json_array(json_object('text','Сегодня в CRM','web_app',json_object('url',?))))))
    FROM users WHERE role='OWNER' AND active=1 AND notifications_allowed=1`).bind(date,
      `Сводка центра · ${date}\nПриёмов сегодня: ${counts?.visits ?? 0}\nПросроченных задач: ${counts?.tasks ?? 0}\nПовторных обращений: ${counts?.followUps ?? 0}\nОшибок доставки: ${counts?.failures ?? 0}`,env.MINI_APP_URL+'/today').run();
}
