import type { CrmEnv } from "../functions/_lib/env";
import { enqueueDueReminders, processOutbox } from "../functions/_lib/notification-delivery";
import { telegramApi } from "../functions/_lib/telegram-bot";
import { APP_VERSION } from "../src/lib/release";
import { privateService } from './private-service';

async function configureBot(env: CrmEnv) {
  const key = "telegram-config-" + APP_VERSION;
  const configured = await env.DB.prepare("SELECT worker_name FROM worker_runs WHERE worker_name = ? AND status = 'OK'").bind(key).first();
  if (configured) return;
  await telegramApi(env,"setMyCommands",{commands:[
    {command:"start",description:"Открыть личный кабинет"},
    {command:"book",description:"Записаться на приём"},
    {command:"appointments",description:"Ближайшие визиты"},
    {command:"profile",description:"Профиль и напоминания"},
    {command:"bonuses",description:"Бонусы"},
    {command:"today",description:"Сегодня — для сотрудников"},
    {command:"contact",description:"Контакты центра"},
    {command:"help",description:"Помощь"},
  ]});
  await telegramApi(env,"setChatMenuButton",{menu_button:{type:"web_app",text:"Открыть кабинет",web_app:{url:env.MINI_APP_URL || "https://podologymk-crm.pages.dev"}}});
  await env.DB.prepare("INSERT INTO worker_runs(worker_name, started_at, completed_at, status) VALUES(?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'OK') ON CONFLICT(worker_name) DO UPDATE SET completed_at = CURRENT_TIMESTAMP, status = 'OK'").bind(key).run();
}

export async function runNotifications(env: CrmEnv) {
  const leaseToken = crypto.randomUUID();
  const claimed = await env.DB.prepare(`INSERT INTO worker_runs(worker_name, started_at, status, lease_token, lease_expires_at)
    VALUES('notifications', CURRENT_TIMESTAMP, 'RUNNING', ?, datetime('now', '+2 minutes'))
    ON CONFLICT(worker_name) DO UPDATE SET started_at = CURRENT_TIMESTAMP, status = 'RUNNING', error_code = NULL,
      lease_token = excluded.lease_token, lease_expires_at = excluded.lease_expires_at
    WHERE worker_runs.lease_expires_at IS NULL OR julianday(worker_runs.lease_expires_at) <= julianday('now')
    RETURNING worker_name`).bind(leaseToken).first();
  if (!claimed) return;
  const deadline = Date.now()+90_000; // Reserve the remaining lease budget for two bounded bot API calls.
  const ownsLease = async () => {
    if (!await env.DB.prepare("SELECT worker_name FROM worker_runs WHERE worker_name='notifications' AND lease_token=? AND julianday(lease_expires_at)>julianday('now')").bind(leaseToken).first()) {
      throw new Error('WORKER_LEASE_LOST');
    }
  };
  try {
    await enqueueDueReminders(env);
    if (env.JOBS) {
      let jobsFailed=false;
      for (const path of ['/schedule','/waitlist','/waitlist']) {
        await ownsLease();
        try {
          await privateService(env.JOBS,path,{method:'POST'},async response=>{
            if(!response.ok) throw new Error('AUTOMATION_UNAVAILABLE');
          },Math.max(1,Math.min(10_000,deadline-Date.now())));
        } catch {jobsFailed=true;}
      }
      await ownsLease();
      await env.DB.prepare(`INSERT INTO worker_runs(worker_name,started_at,completed_at,status,error_code)
        SELECT 'automation',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?,?
        WHERE EXISTS(SELECT 1 FROM worker_runs WHERE worker_name='notifications' AND lease_token=? AND julianday(lease_expires_at)>julianday('now'))
        ON CONFLICT(worker_name) DO UPDATE SET
        started_at=CURRENT_TIMESTAMP,completed_at=CURRENT_TIMESTAMP,status=excluded.status,error_code=excluded.error_code`)
        .bind(jobsFailed?'FAILED':'OK',jobsFailed?'AUTOMATION_UNAVAILABLE':null,leaseToken).run();
    } else {
      await env.DB.prepare(`INSERT INTO worker_runs(worker_name,started_at,completed_at,status,error_code)
        SELECT 'automation',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'FAILED','AUTOMATION_UNAVAILABLE'
        WHERE EXISTS(SELECT 1 FROM worker_runs WHERE worker_name='notifications' AND lease_token=? AND julianday(lease_expires_at)>julianday('now'))
        ON CONFLICT(worker_name) DO UPDATE SET completed_at=CURRENT_TIMESTAMP,status='FAILED',error_code='AUTOMATION_UNAVAILABLE'`).bind(leaseToken).run();
    }
    if (env.DELIVERY) {
      for(let pass=0;pass<8 && Date.now()<deadline;pass++) {
        await ownsLease();
        const result=await privateService(env.DELIVERY,'/drain',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:env.TELEGRAM_BOT_TOKEN})},async response=>{
          if(!response.ok) throw new Error('DELIVERY_UNAVAILABLE');
          const result=await response.json() as {processed:unknown};
          if(!Number.isInteger(result.processed) || Number(result.processed)<0 || Number(result.processed)>3) throw new Error('INVALID_DELIVERY_RESPONSE');
          return {processed:Number(result.processed)};
        },Math.max(1,Math.min(40_000,deadline-Date.now())));
        if(!result.processed) break;
      }
    } else await processOutbox(env);
    await ownsLease();
    // Bot menu configuration is independent from delivery and is retried next cron.
    try { await configureBot(env); } catch {
      await env.DB.prepare("INSERT INTO worker_runs(worker_name, started_at, completed_at, status, error_code) VALUES(?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'FAILED', 'BOT_CONFIG_UNAVAILABLE') ON CONFLICT(worker_name) DO UPDATE SET completed_at = CURRENT_TIMESTAMP, status = 'FAILED', error_code = 'BOT_CONFIG_UNAVAILABLE'")
        .bind("telegram-config-" + APP_VERSION).run();
      console.error(JSON.stringify({ event: "bot_configuration_deferred", code: "BOT_CONFIG_UNAVAILABLE" }));
    }
    await ownsLease();
    await env.DB.batch([
      env.DB.prepare("UPDATE worker_runs SET completed_at = CURRENT_TIMESTAMP, status = 'OK', error_code = NULL, lease_token = NULL, lease_expires_at = NULL WHERE worker_name = 'notifications' AND lease_token = ?").bind(leaseToken),
      env.DB.prepare("DELETE FROM telegram_updates WHERE received_at < datetime('now', '-7 days')"),
      env.DB.prepare("DELETE FROM sessions WHERE julianday(expires_at) < julianday('now')"),
    ]);
  } catch {
    await env.DB.prepare("UPDATE worker_runs SET completed_at = CURRENT_TIMESTAMP, status = 'FAILED', error_code = 'WORKER_FAILED', lease_token = NULL, lease_expires_at = NULL WHERE worker_name = 'notifications' AND lease_token = ?").bind(leaseToken).run();
    console.error(JSON.stringify({ event: "notification_worker_failed", code: "WORKER_FAILED" }));
    throw new Error("Notification worker failed");
  }
}

export default {
  scheduled(_controller: ScheduledController, env: CrmEnv, ctx: ExecutionContext) {
    ctx.waitUntil(runNotifications(env));
  },
};
