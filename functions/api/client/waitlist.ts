import { forbidden, getSessionUser, isClient, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, json, newId, optionalString, readJson } from "../../_lib/http";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isClient(user)) return forbidden();
  if (!user.clientId) return json({ ok: true, items: [] });
  const rows = await env.DB.prepare(`
    SELECT w.id, w.preferred_date AS preferredDate, w.status, s.name AS serviceName, b.name AS branchName
    FROM client_waitlist w LEFT JOIN services s ON s.id = w.service_id LEFT JOIN branches b ON b.id = w.branch_id
    WHERE w.client_id = ? AND w.status IN ('ACTIVE', 'OFFERED') ORDER BY w.created_at DESC
  `).bind(user.clientId).all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isClient(user)) return forbidden();
  if (!user.clientId) return badRequest("Сначала заполните профиль");
  const body = await readJson(request);
  const serviceId = optionalString(body, "serviceId");
  const branchId = optionalString(body, "branchId");
  const employeeId = optionalString(body, "employeeId");
  const preferredDate = optionalString(body, "preferredDate");
  if (!serviceId && !branchId) return badRequest("Выберите хотя бы услугу или филиал");
  const id = newId();
  const result = await env.DB.prepare(`
    INSERT INTO client_waitlist (id, client_id, service_id, branch_id, employee_id, preferred_date)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM client_waitlist
      WHERE client_id = ? AND service_id IS ? AND branch_id IS ? AND employee_id IS ? AND preferred_date IS ?
        AND status IN ('ACTIVE', 'OFFERED')
    )
  `).bind(id, user.clientId, serviceId, branchId, employeeId, preferredDate, user.clientId, serviceId, branchId, employeeId, preferredDate).run();
  if (!result.meta.changes) return json({ ok: false, error: "Вы уже добавлены в лист ожидания на этот запрос.", code: "WAITLIST_DUPLICATE" }, 409);
  return json({ ok: true, id }, 201);
};
