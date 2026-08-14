import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { json, readJson, stringValue } from "../_lib/http";
import { getOwnEmployeeId } from "../_lib/access";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "reviews.read")) return forbidden();
  const ownEmployeeId = await getOwnEmployeeId(env.DB, user);
  if (user.role === "SPECIALIST" && !ownEmployeeId) return json({ ok: true, items: [] });
  const scope = user.role === "SPECIALIST" ? " AND EXISTS (SELECT 1 FROM appointments scoped_review_a WHERE scoped_review_a.id = r.appointment_id AND scoped_review_a.employee_id = ?)" : "";
  const rows = await env.DB.prepare(`
    SELECT r.id, r.appointment_id AS appointmentId, r.rating, r.review_text AS reviewText, r.status, r.created_at AS createdAt,
      c.full_name AS clientName, s.name AS serviceName
    FROM client_reviews r INNER JOIN clients c ON c.id = r.client_id
    LEFT JOIN appointment_services aps ON aps.appointment_id = r.appointment_id
    LEFT JOIN services s ON s.id = aps.service_id
    WHERE 1 = 1${scope}
    ORDER BY r.created_at DESC LIMIT 100
  `).bind(...(user.role === "SPECIALIST" ? [ownEmployeeId] : [])).all();
  return json({ ok: true, items: rows.results ?? [] });
};

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "reviews.write")) return forbidden();
  const body = await readJson(request);
  const id = stringValue(body, "id");
  const status = stringValue(body, "status").toUpperCase();
  if (!id || !["PUBLISHED", "HIDDEN", "PENDING"].includes(status)) return json({ ok: false, error: "Некорректный статус отзыва" }, 400);
  await env.DB.prepare("UPDATE client_reviews SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(status, id).run();
  return json({ ok: true });
};
