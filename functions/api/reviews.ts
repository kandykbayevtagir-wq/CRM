import { forbidden, getSessionUser, isStaff, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { json, readJson, stringValue } from "../_lib/http";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isStaff(user)) return forbidden();
  const rows = await env.DB.prepare(`
    SELECT r.id, r.appointment_id AS appointmentId, r.rating, r.review_text AS reviewText, r.status, r.created_at AS createdAt,
      c.full_name AS clientName, s.name AS serviceName
    FROM client_reviews r INNER JOIN clients c ON c.id = r.client_id
    LEFT JOIN appointment_services aps ON aps.appointment_id = r.appointment_id
    LEFT JOIN services s ON s.id = aps.service_id
    ORDER BY r.created_at DESC LIMIT 100
  `).all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isStaff(user)) return forbidden();
  const body = await readJson(request);
  const id = stringValue(body, "id");
  const status = stringValue(body, "status").toUpperCase();
  if (!id || !["PUBLISHED", "HIDDEN", "PENDING"].includes(status)) return json({ ok: false, error: "Некорректный статус отзыва" }, 400);
  await env.DB.prepare("UPDATE client_reviews SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(status, id).run();
  return json({ ok: true });
};
