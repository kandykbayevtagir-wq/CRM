import { getSessionUser, forbidden, hasCrmPermission, unauthorized } from "../_lib/auth";
import { auditStatement } from "../_lib/audit";
import type { CrmEnv } from "../_lib/env";
import { badRequest, json, newId, notFound, readJson, stringValue } from "../_lib/http";
import { isoColumn } from "../_lib/dates";
import { localDate, localDayRange } from "../../src/lib/appointments/schedule";
import { processOutbox } from "../_lib/notification-delivery";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "appointments.manage_all")) return forbidden();
  const params = new URL(request.url).searchParams;
  const settings = await env.DB.prepare("SELECT timezone FROM organization_settings WHERE id = 1").first<{ timezone: string }>();
  const timezone = settings?.timezone || "Asia/Almaty";
  const date = params.get("date") || localDate(new Date(), timezone);
  const parsedDate = new Date(date + "T12:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0,10) !== date) return badRequest("Некорректная дата");
  const { from, to } = localDayRange(date, timezone);
  const branchId = params.get("branchId") || "";
  const [appointments, queue, failures, worker, obligations, waitlist] = await Promise.all([
    env.DB.prepare(`SELECT a.id, a.revision, ${isoColumn("a.starts_at")} AS startsAt, ${isoColumn("a.ends_at")} AS endsAt, a.status, a.total_amount AS amount,
      a.client_id AS clientId, c.full_name AS clientName, c.phone AS clientPhone, e.full_name AS employeeName, b.name AS branchName,
      (SELECT group_concat(s.name, ', ') FROM appointment_services aps JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id) AS serviceName,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.appointment_id = a.id AND p.payment_status = 'POSTED'),0) -
      COALESCE((SELECT SUM(pa.amount) FROM payment_adjustments pa WHERE pa.appointment_id = a.id),0) AS paidAmount
      FROM appointments a JOIN clients c ON c.id = a.client_id
      LEFT JOIN employees e ON e.id = a.employee_id LEFT JOIN branches b ON b.id = a.branch_id
      WHERE julianday(a.starts_at) >= julianday(?) AND julianday(a.starts_at) < julianday(?) ${branchId ? "AND a.branch_id = ?" : ""}
      ORDER BY julianday(a.starts_at) LIMIT 200`).bind(from, to, ...(branchId ? [branchId] : [])).all(),
    env.DB.prepare("SELECT status, COUNT(*) AS count FROM message_outbox WHERE status IN ('PENDING','PROCESSING','FAILED') GROUP BY status").all(),
    env.DB.prepare("SELECT id, template_key AS kind, attempts, last_error AS errorCode, updated_at AS updatedAt FROM message_outbox WHERE status = 'FAILED' ORDER BY updated_at DESC LIMIT 20").all(),
    env.DB.prepare("SELECT status, started_at AS startedAt, completed_at AS completedAt, error_code AS errorCode FROM worker_runs WHERE worker_name = 'notifications'").first<{ status: string; completedAt: string | null }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM appointments a WHERE a.status = 'COMPLETED'
      AND a.total_amount > COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.appointment_id = a.id AND p.payment_status = 'POSTED'),0) -
      COALESCE((SELECT SUM(pa.amount) FROM payment_adjustments pa WHERE pa.appointment_id = a.id),0)
      ${branchId ? "AND a.branch_id = ?" : ""}`).bind(...(branchId ? [branchId] : [])).first(),
    env.DB.prepare(`SELECT w.id, c.full_name AS clientName, c.phone, s.name AS serviceName, b.name AS branchName, w.preferred_date AS preferredDate
      FROM client_waitlist w JOIN clients c ON c.id = w.client_id
      LEFT JOIN services s ON s.id = w.service_id LEFT JOIN branches b ON b.id = w.branch_id
      WHERE w.status IN ('ACTIVE','OFFERED') ${branchId ? "AND (w.branch_id = ? OR w.branch_id IS NULL)" : ""}
      ORDER BY w.created_at, w.id LIMIT 30`).bind(...(branchId ? [branchId] : [])).all(),
  ]);
  return json({ ok: true, date, timezone, items: appointments.results ?? [], queue: queue.results ?? [],
    failures: failures.results ?? [], waitlist: waitlist.results ?? [], worker, overdueBalances: obligations, workerStale: worker?.status !== "OK" || !worker?.completedAt || Date.now() - Date.parse(worker.completedAt.replace(" ", "T") + (worker.completedAt.endsWith("Z") ? "" : "Z")) > 15 * 60000 });
};

export const onRequestPost: PagesFunction<CrmEnv> = async (context) => {
  const { request, env } = context;
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "appointments.manage_all")) return forbidden();
  const body = await readJson(request);
  if (stringValue(body, "action") === "close_waitlist") {
    const id = stringValue(body, "waitlistId");
    const row = await env.DB.prepare("SELECT status FROM client_waitlist WHERE id = ?").bind(id).first<{status:string}>();
    if (!row) return notFound("Заявка не найдена");
    if (!["ACTIVE","OFFERED"].includes(row.status)) return json({ok:true,replayed:true});
    const guardId = newId();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO mutation_guards(id, passed) SELECT ?, EXISTS(SELECT 1 FROM client_waitlist WHERE id = ? AND status = ?)").bind(guardId,id,row.status),
      env.DB.prepare("DELETE FROM mutation_guards WHERE id = ?").bind(guardId),
      env.DB.prepare("UPDATE client_waitlist SET status = 'CANCELLED' WHERE id = ?").bind(id),
      auditStatement(env.DB,user,"waitlist",id,"CLOSE",{status:row.status},{status:"CANCELLED"}),
    ]);
    return json({ok:true});
  }
  const id = stringValue(body, "messageId");
  const row = await env.DB.prepare("SELECT event_key AS eventKey FROM message_outbox WHERE id = ? AND status = 'FAILED'").bind(id).first<{ eventKey: string }>();
  if (!row) return notFound("Сообщение уже обработано или не найдено");
  const guardId = newId();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO mutation_guards(id, passed) SELECT ?, EXISTS(SELECT 1 FROM message_outbox WHERE id = ? AND status = 'FAILED')").bind(guardId, id),
    env.DB.prepare("DELETE FROM mutation_guards WHERE id = ?").bind(guardId),
    env.DB.prepare("UPDATE message_outbox SET status = 'PENDING', attempts = 0, next_retry_at = CURRENT_TIMESTAMP, lease_token = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id),
    auditStatement(env.DB, user, "message_outbox", id, "RETRY", { status: "FAILED" }, { status: "PENDING" }),
  ]);
  context.waitUntil(processOutbox(env, row.eventKey).catch(() => console.error(JSON.stringify({ event: "manual_delivery_deferred", messageId: id }))));
  return json({ ok: true });
};
