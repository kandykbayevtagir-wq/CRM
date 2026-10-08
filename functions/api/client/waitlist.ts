import { getActiveClientId } from "../../_lib/access";
import { forbidden, getSessionUser, isClient, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, json, newId, optionalString, readJson } from "../../_lib/http";
import { isoColumn } from '../../_lib/dates';
import { auditStatement } from '../../_lib/audit';
import { validHold } from '../../_lib/offer-eligibility';

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isClient(user)) return forbidden();
  if (!await getActiveClientId(env.DB,user)) return json({ ok: true, items: [] });
  const rows = await env.DB.prepare(`
    SELECT w.id, w.preferred_date AS preferredDate, w.status, w.appointment_id AS appointmentId,
      w.service_id AS serviceId,COALESCE(h.branch_id,w.branch_id) AS branchId,s.name AS serviceName, b.name AS branchName,
      h.id AS holdId,h.employee_id AS employeeId,e.full_name AS employeeName,
      ${isoColumn('h.starts_at')} AS startsAt,${isoColumn('h.expires_at')} AS expiresAt
    FROM client_waitlist w LEFT JOIN services s ON s.id = w.service_id
    LEFT JOIN booking_holds h ON h.waitlist_id=w.id AND ${validHold('h')}
    LEFT JOIN branches b ON b.id=COALESCE(h.branch_id,w.branch_id)
    LEFT JOIN employees e ON e.id=h.employee_id
    WHERE w.client_id = ? AND w.status IN ('ACTIVE', 'OFFERED') ORDER BY w.created_at DESC
  `).bind(user.clientId).all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isClient(user)) return forbidden();
  if (!user.clientId) return badRequest("Сначала заполните профиль");
  if (!await getActiveClientId(env.DB, user)) return forbidden("Карточка клиента архивирована. Обратитесь к администратору центра.");
  const body = await readJson(request);
  const serviceId = optionalString(body, "serviceId");
  const branchId = optionalString(body, "branchId");
  const employeeId = optionalString(body, "employeeId");
  const preferredDate = optionalString(body, "preferredDate");
  const appointmentId = optionalString(body,'appointmentId');
  if (appointmentId && !await env.DB.prepare(`SELECT id FROM appointments a WHERE a.id=? AND a.client_id=?
    AND a.status IN ('SCHEDULED','CONFIRMED') AND NOT EXISTS(SELECT 1 FROM payments WHERE appointment_id=a.id)
    AND (SELECT COUNT(*) FROM appointment_services WHERE appointment_id=a.id)=1
    AND EXISTS(SELECT 1 FROM appointment_services WHERE appointment_id=a.id AND service_id=?)
    AND julianday(a.starts_at)>julianday('now','+'||(SELECT cancellation_window_hours FROM organization_settings WHERE id=1)||' hours')`)
    .bind(appointmentId,user.clientId,serviceId).first()) return badRequest('Для этой записи нельзя автоматически предложить более раннее время');
  if (!serviceId && !branchId) return badRequest("Выберите хотя бы услугу или филиал");
  if (preferredDate && (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate) || Number.isNaN(Date.parse(preferredDate+"T12:00:00Z")) || new Date(preferredDate+"T12:00:00Z").toISOString().slice(0,10) !== preferredDate)) return badRequest("Некорректная дата");
  if (serviceId && !await env.DB.prepare("SELECT id FROM services WHERE id = ? AND is_active = 1").bind(serviceId).first()) return badRequest("Услуга недоступна");
  if (branchId && !await env.DB.prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1").bind(branchId).first()) return badRequest("Филиал недоступен");
  if (employeeId && !await env.DB.prepare("SELECT id FROM employees WHERE id = ? AND is_active = 1").bind(employeeId).first()) return badRequest("Специалист недоступен");
  const id = newId();
  const result = await env.DB.prepare(`
    INSERT INTO client_waitlist (id, client_id, service_id, branch_id, employee_id, preferred_date, appointment_id)
    SELECT ?, ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM client_waitlist
      WHERE client_id = ? AND service_id IS ? AND branch_id IS ? AND employee_id IS ? AND preferred_date IS ? AND appointment_id IS ?
        AND status IN ('ACTIVE', 'OFFERED')
    )
  `).bind(id, user.clientId, serviceId, branchId, employeeId, preferredDate, appointmentId, user.clientId, serviceId, branchId, employeeId, preferredDate,appointmentId).run();
  if (!result.meta.changes) return json({ ok: false, error: "Вы уже добавлены в лист ожидания на этот запрос.", code: "WAITLIST_DUPLICATE" }, 409);
  return json({ ok: true, id }, 201);
};

export const onRequestPatch: PagesFunction<CrmEnv> = async ({request,env})=>{
  const user=await getSessionUser(request,env.DB);
  if(!user) return unauthorized();
  if(!isClient(user)) return forbidden();
  const body=await readJson(request); const id=optionalString(body,'id');
  if(!['decline','cancel'].includes(String(body.action))) return badRequest('Некорректное действие');
  const row=await env.DB.prepare('SELECT status FROM client_waitlist WHERE id=? AND client_id=?').bind(id,user.clientId).first<{status:string}>();
  if(!row) return forbidden();
  if(!['ACTIVE','OFFERED'].includes(row.status)) return json({ok:true,replayed:true});
  const guard=newId();const status=body.action==='cancel'?'CANCELLED':'ACTIVE';
  await env.DB.batch([
    env.DB.prepare('INSERT INTO mutation_guards(id,passed) SELECT ?,EXISTS(SELECT 1 FROM client_waitlist WHERE id=? AND client_id=? AND status=?)').bind(guard,id,user.clientId,row.status),
    env.DB.prepare('DELETE FROM mutation_guards WHERE id=?').bind(guard),
    env.DB.prepare("UPDATE booking_holds SET status='RELEASED' WHERE waitlist_id=? AND status='HELD'").bind(id),
    env.DB.prepare("UPDATE client_waitlist SET status=?,retry_after=datetime('now','+1 minute') WHERE id=?").bind(status,id),
    auditStatement(env.DB,user,'waitlist',id!,String(body.action).toUpperCase(),{status:row.status},{status}),
  ]);
  return json({ok:true});
};
