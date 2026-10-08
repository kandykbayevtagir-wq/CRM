/** SQL fragments receive only repository-controlled column expressions, never user input. */
export function activeBookingResources(client: string, service: string, branch: string, employee: string) {
  return `EXISTS(SELECT 1 FROM clients WHERE id=${client} AND is_active=1)
    AND EXISTS(SELECT 1 FROM services WHERE id=${service} AND is_active=1)
    AND EXISTS(SELECT 1 FROM branches WHERE id=${branch} AND is_active=1)
    AND EXISTS(SELECT 1 FROM employees WHERE id=${employee} AND is_active=1)
    AND EXISTS(SELECT 1 FROM employee_branches WHERE employee_id=${employee} AND branch_id=${branch})
    AND EXISTS(SELECT 1 FROM employee_services WHERE employee_id=${employee} AND service_id=${service}
      AND active=1 AND (branch_id IS NULL OR branch_id=${branch}))`;
}

export function eligibleWaiter(w: string, startsAt?: string) {
  return `EXISTS(SELECT 1 FROM clients WHERE id=${w}.client_id AND is_active=1)
    AND (${w}.appointment_id IS NULL OR EXISTS(SELECT 1 FROM appointments a WHERE a.id=${w}.appointment_id
      AND a.client_id=${w}.client_id AND a.status IN ('SCHEDULED','CONFIRMED')
      AND julianday(a.starts_at)>julianday('now','+'||COALESCE((SELECT cancellation_window_hours FROM organization_settings WHERE id=1),2)||' hours')
      AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.appointment_id=a.id)
      ${startsAt ? 'AND julianday('+startsAt+')<julianday(a.starts_at)' : ''}))`;
}

export function validHold(h: string) {
  return `${h}.status='HELD' AND julianday(${h}.expires_at)>julianday('now')
    AND julianday(${h}.starts_at)>julianday('now','+5 minutes')
    AND ${activeBookingResources(h+'.client_id',h+'.service_id',h+'.branch_id',h+'.employee_id')}
    AND EXISTS(SELECT 1 FROM client_waitlist w WHERE w.id=${h}.waitlist_id AND w.status='OFFERED'
      AND w.client_id=${h}.client_id AND w.service_id=${h}.service_id AND w.appointment_id IS ${h}.appointment_id
      AND (w.branch_id IS NULL OR w.branch_id=${h}.branch_id)
      AND (w.employee_id IS NULL OR w.employee_id=${h}.employee_id) AND ${eligibleWaiter('w',h+'.starts_at')})
    AND NOT EXISTS(SELECT 1 FROM employee_time_off t WHERE t.employee_id=${h}.employee_id
      AND julianday(t.starts_at)<julianday(${h}.ends_at) AND julianday(t.ends_at)>julianday(${h}.starts_at))
    AND NOT EXISTS(SELECT 1 FROM branch_closures b WHERE (b.branch_id IS NULL OR b.branch_id=${h}.branch_id)
      AND julianday(b.starts_at)<julianday(${h}.ends_at) AND julianday(b.ends_at)>julianday(${h}.starts_at))`;
}

/** Recheck the selected slot's calendar inside the same D1 transaction as its write. */
export function eligibleCalendar(c: string, clock=c) {
  return `EXISTS(SELECT 1 FROM organization_settings os JOIN employee_schedules s ON s.employee_id=${c}.employee_id
    WHERE os.id=1 AND s.is_active=1 AND s.day_of_week=${clock}.day
      AND instr(','||os.working_days||',',','||CAST(${clock}.day AS INTEGER)||',')>0
      AND ${clock}.start_time>=os.booking_start_time AND ${clock}.end_time<=os.booking_end_time
      AND ${clock}.start_time>=s.starts_time AND ${clock}.end_time<=s.ends_time
      AND (s.break_start_time IS NULL OR s.break_end_time IS NULL OR ${clock}.end_time<=s.break_start_time OR ${clock}.start_time>=s.break_end_time))
    AND NOT EXISTS(SELECT 1 FROM employee_time_off t WHERE t.employee_id=${c}.employee_id
      AND julianday(t.starts_at)<julianday(${c}.ends_at) AND julianday(t.ends_at)>julianday(${c}.starts_at))
    AND NOT EXISTS(SELECT 1 FROM branch_closures b WHERE (b.branch_id IS NULL OR b.branch_id=${c}.branch_id)
      AND julianday(b.starts_at)<julianday(${c}.ends_at) AND julianday(b.ends_at)>julianday(${c}.starts_at))`;
}

export function calendarValues(startsAt: string, endsAt: string, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-GB', {timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const date = new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(startsAt));
  const day = new Date(date+'T12:00:00Z').getUTCDay();
  return [day || 7, formatter.format(new Date(startsAt)), formatter.format(new Date(endsAt))] as const;
}

export async function deliverableHold(db: D1Database, id: string, clientId: string) {
  const hold=await db.prepare(`SELECT h.starts_at AS startsAt,h.ends_at AS endsAt,os.timezone
    FROM booking_holds h CROSS JOIN organization_settings os WHERE h.id=? AND h.client_id=? AND os.id=1 AND ${validHold('h')}`)
    .bind(id,clientId).first<{startsAt:string;endsAt:string;timezone:string}>();
  if (!hold) return false;
  return Boolean(await db.prepare(`WITH calendar AS (SELECT ? AS day,? AS start_time,? AS end_time)
    SELECT h.id FROM booking_holds h CROSS JOIN calendar v WHERE h.id=? AND h.client_id=? AND ${validHold('h')}
    AND ${eligibleCalendar('h','v')}`)
    .bind(...calendarValues(hold.startsAt,hold.endsAt,hold.timezone),id,clientId).first());
}
