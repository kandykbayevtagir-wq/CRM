import type { CrmEnv } from './env';

/** Each page and cursor commit atomically: crashes resume the same campaign. */
export async function prepareCampaigns(env: CrmEnv) {
  await env.DB.prepare(`UPDATE campaigns SET status='PROCESSING', preparation_complete=0,
    preparation_cursor='', started_at=CURRENT_TIMESTAMP, recipient_count=0, updated_at=CURRENT_TIMESTAMP
    WHERE status='SCHEDULED' AND scheduled_at IS NOT NULL AND julianday(scheduled_at)<=julianday('now')`).run();
  const campaigns = await env.DB.prepare(`SELECT id, preparation_cursor AS cursor FROM campaigns
    WHERE status='PROCESSING' AND preparation_complete=0 ORDER BY started_at,id LIMIT 2`).all<{id:string;cursor:string}>();
  for (const campaign of campaigns.results ?? []) {
    const guard = crypto.randomUUID();
    try { await env.DB.batch([
      env.DB.prepare(`INSERT INTO mutation_guards(id,passed) SELECT ?, EXISTS(SELECT 1 FROM campaigns
        WHERE id=? AND status='PROCESSING' AND preparation_complete=0 AND preparation_cursor=?)`).bind(guard,campaign.id,campaign.cursor),
      env.DB.prepare('DELETE FROM mutation_guards WHERE id=?').bind(guard),
      env.DB.prepare(`INSERT OR IGNORE INTO campaign_recipients(id,campaign_id,client_id,telegram_id)
        SELECT lower(hex(randomblob(16))), ca.id,c.id,u.telegram_id FROM campaigns ca
        JOIN clients c ON c.id>ca.preparation_cursor AND julianday(c.created_at)<=julianday(ca.started_at)
        JOIN users u ON u.client_id=c.id AND u.active=1 AND u.notifications_allowed=1
        LEFT JOIN client_segments cs ON cs.id=ca.segment_id
        WHERE ca.id=? AND ca.status='PROCESSING' AND ca.preparation_complete=0 AND c.is_active=1
          AND u.id=(SELECT MIN(u2.id) FROM users u2 WHERE u2.client_id=c.id AND u2.active=1 AND u2.notifications_allowed=1)
          AND EXISTS(SELECT 1 FROM client_consents cc WHERE cc.client_id=c.id AND cc.kind='MARKETING' AND cc.revoked_at IS NULL)
          AND (ca.segment_id IS NULL OR (cs.id IS NOT NULL
            AND (json_extract(cs.criteria_json,'$.minVisits') IS NULL OR
              (SELECT COUNT(*) FROM appointments av WHERE av.client_id=c.id AND av.status='COMPLETED')>=json_extract(cs.criteria_json,'$.minVisits'))
            AND (json_extract(cs.criteria_json,'$.minRevenue') IS NULL OR
              (SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN appointments ap ON ap.id=p.appointment_id
                WHERE ap.client_id=c.id AND p.payment_status='POSTED')>=json_extract(cs.criteria_json,'$.minRevenue'))))
        ORDER BY c.id,u.id LIMIT 40`).bind(campaign.id),
      env.DB.prepare(`INSERT OR IGNORE INTO message_outbox(id,event_key,telegram_id,template_key,payload_json)
        SELECT lower(hex(randomblob(16))), 'campaign:'||cr.campaign_id||':'||cr.client_id, cr.telegram_id,'CAMPAIGN',
          json_object('message',ca.message,'clientName',c.full_name,'campaignId',ca.id,'clientId',c.id)
        FROM campaign_recipients cr JOIN campaigns ca ON ca.id=cr.campaign_id JOIN clients c ON c.id=cr.client_id
        WHERE ca.id=? AND ca.status='PROCESSING' AND cr.status='PENDING'
          AND NOT EXISTS(SELECT 1 FROM message_outbox mo WHERE mo.event_key='campaign:'||ca.id||':'||c.id)`).bind(campaign.id),
      env.DB.prepare(`UPDATE campaigns SET preparation_complete=CASE WHEN
          (SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id=? AND client_id>?)<40 THEN 1 ELSE 0 END,
        preparation_cursor=COALESCE((SELECT MAX(client_id) FROM campaign_recipients WHERE campaign_id=?),preparation_cursor),
        recipient_count=(SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id=?),updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .bind(campaign.id,campaign.cursor,campaign.id,campaign.id,campaign.id),
    ]); } catch (error) {
      // A concurrent cancellation invalidates the guard, rolling back the entire page.
      if (!String(error).includes('mutation_precondition')) throw error;
    }
  }
  await env.DB.prepare(`UPDATE campaigns SET status='COMPLETED',updated_at=CURRENT_TIMESTAMP
    WHERE status='PROCESSING' AND preparation_complete=1 AND NOT EXISTS(
      SELECT 1 FROM campaign_recipients cr WHERE cr.campaign_id=campaigns.id AND cr.status='PENDING')`).run();
}

export async function enqueueScheduledTasks(env: CrmEnv) {
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO message_outbox(id,event_key,telegram_id,template_key,payload_json)
      SELECT lower(hex(randomblob(16))), 'follow-up-due:'||f.id||':'||f.recommended_date, u.telegram_id,'FOLLOW_UP_DUE',
        json_object('clientId',c.id,'clientName',c.full_name,'followUpId',f.id,'recommendedDate',f.recommended_date,
          'replyMarkup',json_object('inline_keyboard',json_array(json_array(json_object('text','Выбрать время','web_app',json_object('url',?))))))
      FROM follow_ups f JOIN clients c ON c.id=f.client_id JOIN users u ON u.client_id=c.id
      WHERE f.status='OPEN' AND julianday(f.recommended_date)<=julianday('now')
        AND julianday(f.recommended_date)>julianday('now','-30 days') AND c.is_active=1 AND u.active=1 AND u.notifications_allowed=1
        AND NOT EXISTS(SELECT 1 FROM message_outbox mo WHERE mo.event_key='follow-up-due:'||f.id||':'||f.recommended_date)
      ORDER BY f.recommended_date LIMIT 100`).bind(env.MINI_APP_URL+'/client/book'),
    env.DB.prepare(`INSERT OR IGNORE INTO message_outbox(id,event_key,telegram_id,template_key,payload_json)
      SELECT lower(hex(randomblob(16))), 'task-due:'||t.id||':'||t.due_date,u.telegram_id,'DIRECT',
        json_object('userId',u.id,'requiredPermission','tasks.read','respectNotifications',1,'taskId',t.id,'taskDueDate',t.due_date,
          'message','Задача требует внимания: '||t.title,
          'replyMarkup',json_object('inline_keyboard',json_array(json_array(json_object('text','Открыть задачи','web_app',json_object('url',?))))))
      FROM tasks t JOIN users u ON u.id=t.assignee_id WHERE t.status IN ('OPEN','IN_PROGRESS')
        AND julianday(t.due_date)<=julianday('now') AND julianday(t.due_date)>julianday('now','-30 days')
        AND u.active=1 AND u.notifications_allowed=1 AND u.role<>'CLIENT'
        AND NOT EXISTS(SELECT 1 FROM message_outbox mo WHERE mo.event_key='task-due:'||t.id||':'||t.due_date)
        ORDER BY t.due_date LIMIT 100`).bind(env.MINI_APP_URL+'/tasks'),
  ]);
}
