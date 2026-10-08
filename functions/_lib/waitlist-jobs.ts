import { findAvailableSlots } from './availability';
import { localDate } from '../../src/lib/appointments/schedule';
import type { CrmEnv } from './env';
import { HttpError } from './security';
import { activeBookingResources, calendarValues, eligibleCalendar, eligibleWaiter, validHold } from './offer-eligibility';

export async function expireOffers(env: CrmEnv) {
  await env.DB.batch([
    env.DB.prepare(`UPDATE client_waitlist SET status='EXPIRED' WHERE status IN ('ACTIVE','OFFERED') AND (
      NOT EXISTS(SELECT 1 FROM clients c WHERE c.id=client_waitlist.client_id AND c.is_active=1)
      OR (service_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM services s WHERE s.id=client_waitlist.service_id AND s.is_active=1))
      OR (branch_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM branches b WHERE b.id=client_waitlist.branch_id AND b.is_active=1))
      OR (employee_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM employees e WHERE e.id=client_waitlist.employee_id AND e.is_active=1)))`),
    env.DB.prepare(`UPDATE client_waitlist SET status='CANCELLED' WHERE status IN ('ACTIVE','OFFERED')
      AND appointment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM appointments a WHERE a.id=client_waitlist.appointment_id
        AND a.client_id=client_waitlist.client_id AND a.status IN ('SCHEDULED','CONFIRMED')
        AND julianday(a.starts_at)>julianday('now','+'||(SELECT cancellation_window_hours FROM organization_settings WHERE id=1)||' hours')
        AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.appointment_id=a.id))`),
    env.DB.prepare(`UPDATE booking_holds AS h SET status='EXPIRED' WHERE status='HELD' AND NOT (${validHold('h')})`),
    env.DB.prepare(`UPDATE client_waitlist SET status='ACTIVE',retry_after=datetime('now','+1 minute') WHERE status='OFFERED'
      AND NOT EXISTS(SELECT 1 FROM booking_holds h WHERE h.waitlist_id=client_waitlist.id AND h.status='HELD')`),
  ]);
}

/** One waiter per invocation keeps every API/D1 request below the Free-plan budget. */
export async function offerWaitlistSlot(env: CrmEnv) {
  await expireOffers(env);
  const waiter=await env.DB.prepare(`SELECT w.id,w.client_id AS clientId,w.service_id AS serviceId,
    w.branch_id AS branchId,w.employee_id AS employeeId,w.preferred_date AS preferredDate,w.appointment_id AS appointmentId,
    w.scan_offset AS scanOffset,
    c.full_name AS clientName,u.telegram_id AS telegramId,
    (SELECT a.starts_at FROM appointments a WHERE a.id=w.appointment_id AND a.status IN ('SCHEDULED','CONFIRMED')) AS beforeAt
    FROM client_waitlist w JOIN clients c ON c.id=w.client_id JOIN users u ON u.client_id=c.id
    WHERE w.status='ACTIVE' AND w.service_id IS NOT NULL AND c.is_active=1 AND u.active=1 AND u.notifications_allowed=1
      AND (w.retry_after IS NULL OR julianday(w.retry_after)<=julianday('now'))
      AND (w.appointment_id IS NULL OR EXISTS(SELECT 1 FROM appointments a WHERE a.id=w.appointment_id
        AND a.client_id=c.id AND a.status IN ('SCHEDULED','CONFIRMED')
        AND julianday(a.starts_at)>julianday('now','+'||(SELECT cancellation_window_hours FROM organization_settings WHERE id=1)||' hours')
        AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.appointment_id=a.id)))
    ORDER BY w.created_at,w.id LIMIT 1`).first<{id:string;clientId:string;serviceId:string;branchId:string|null;employeeId:string|null;preferredDate:string|null;appointmentId:string|null;clientName:string;telegramId:string;beforeAt:string|null;scanOffset:number}>();
  if (!waiter) return;
  // Rotate requests with no matching slot instead of blocking the FIFO queue indefinitely.
  await env.DB.prepare("UPDATE client_waitlist SET retry_after=datetime('now','+5 minutes') WHERE id=? AND status='ACTIVE'").bind(waiter.id).run();
  const settings=await env.DB.prepare('SELECT timezone FROM organization_settings WHERE id=1').first<{timezone:string}>();
  const timezone=settings?.timezone || 'Asia/Almaty';
  const today=localDate(new Date(),timezone);
  const attempted=await env.DB.prepare('SELECT starts_at AS startsAt,employee_id AS employeeId FROM booking_holds WHERE waitlist_id=?').bind(waiter.id).all<{startsAt:string;employeeId:string}>();
  // Scan one day per invocation; cursor-free rotation also finds slots freed by a cancellation.
  const offset=waiter.preferredDate?0:waiter.scanOffset;
  const date=waiter.preferredDate || new Date(Date.parse(today+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);
  if (date<today) {await env.DB.prepare("UPDATE client_waitlist SET status='EXPIRED' WHERE id=? AND status='ACTIVE'").bind(waiter.id).run();return;}
  let slots;
  try {slots=await findAvailableSlots(env.DB,{date,branchId:waiter.branchId || undefined,serviceId:waiter.serviceId,employeeId:waiter.employeeId || undefined,
    acceptSlot:s=>Date.parse(s.startsAt)>Date.now()+15*60000 && (!waiter.beforeAt || Date.parse(s.startsAt)<Date.parse(waiter.beforeAt))
      && !(attempted.results ?? []).some(h=>h.startsAt===s.startsAt && h.employeeId===s.employeeId)});}
  catch(error) {
    // A resource may be archived after selecting the waiter. The next pass expires it.
    if(error instanceof HttpError && error.status===404) return;
    throw error;
  }
  const slot=slots[0];
  if (!waiter.preferredDate) await env.DB.prepare('UPDATE client_waitlist SET scan_offset=? WHERE id=?').bind((offset+1)%14,waiter.id).run();
  if (!slot) return;
  const holdId=crypto.randomUUID(); const guard=crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO mutation_guards(id,passed)
        WITH candidate AS (SELECT ? AS client_id,? AS service_id,? AS branch_id,? AS employee_id,
          ? AS starts_at,? AS ends_at,? AS day,? AS start_time,? AS end_time)
        SELECT ?, EXISTS(SELECT 1 FROM client_waitlist w CROSS JOIN candidate c WHERE w.id=? AND w.status='ACTIVE'
          AND w.client_id=c.client_id AND w.service_id=c.service_id
          AND (w.branch_id IS NULL OR w.branch_id=c.branch_id) AND (w.employee_id IS NULL OR w.employee_id=c.employee_id)
          AND ${eligibleWaiter('w')} AND ${activeBookingResources('c.client_id','c.service_id','c.branch_id','c.employee_id')}
          AND ${eligibleCalendar('c')}
          AND EXISTS(SELECT 1 FROM users u WHERE u.client_id=w.client_id AND u.telegram_id=? AND u.active=1 AND u.notifications_allowed=1))`)
        .bind(waiter.clientId,waiter.serviceId,slot.branchId,slot.employeeId,slot.startsAt,slot.endsAt,
          ...calendarValues(slot.startsAt,slot.endsAt,timezone),guard,waiter.id,waiter.telegramId),
      env.DB.prepare('DELETE FROM mutation_guards WHERE id=?').bind(guard),
      env.DB.prepare(`INSERT INTO booking_holds(id,client_id,branch_id,employee_id,starts_at,ends_at,expires_at,service_id,waitlist_id,appointment_id)
        VALUES(?,?,?,?,?,?,datetime('now','+10 minutes'),?,?,?)`).bind(holdId,waiter.clientId,slot.branchId,slot.employeeId,slot.startsAt,slot.endsAt,waiter.serviceId,waiter.id,waiter.appointmentId),
      env.DB.prepare("UPDATE client_waitlist SET status='OFFERED',offer_count=offer_count+1 WHERE id=?").bind(waiter.id),
      env.DB.prepare(`INSERT INTO message_outbox(id,event_key,telegram_id,template_key,payload_json) VALUES(?,?,?,'WAITLIST_OFFER',?)`)
        .bind(crypto.randomUUID(),'waitlist:'+holdId,waiter.telegramId,JSON.stringify({holdId,clientId:waiter.clientId,clientName:waiter.clientName,startsAt:slot.startsAt,timezone,service:(await env.DB.prepare('SELECT name FROM services WHERE id=?').bind(waiter.serviceId).first<{name:string}>())?.name || 'Приём',specialist:slot.employeeName,branch:slot.branchName,
          replyMarkup:{inline_keyboard:[[{text:'Подтвердить свободное окно',web_app:{url:env.MINI_APP_URL+'/client/appointments#waitlist'}}]]}})),
    ]);
  } catch(error) {
    if (!/CRM_SLOT_UNAVAILABLE|mutation_precondition|unique/i.test(error instanceof Error?error.message:'')) throw error;
  }
}
