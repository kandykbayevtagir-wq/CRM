import { forbidden, getSessionUser, isClient, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, json, newId, optionalString, readJson, stringValue } from "../../_lib/http";

function normalizedPhone(value: string) {
  return value.replace(/[^\d+]/g, "").trim();
}

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isClient(user)) return forbidden();
  const client = user.clientId
    ? await env.DB.prepare(`
        SELECT id, full_name AS fullName, phone, email, notes, created_at AS createdAt,
          (SELECT points_balance FROM loyalty_accounts la WHERE la.client_id = c.id) AS pointsBalance
        FROM clients c WHERE c.id = ?
      `).bind(user.clientId).first()
    : null;
  const consents = user.clientId
    ? await env.DB.prepare("SELECT kind, version, granted_at AS grantedAt FROM client_consents WHERE client_id = ? AND revoked_at IS NULL ORDER BY kind ASC").bind(user.clientId).all()
    : { results: [] };
  return json({ ok: true, user, profile: client, consents: consents.results ?? [] });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isClient(user)) return forbidden();
  const body = await readJson(request);
  const fullName = stringValue(body, "fullName");
  const phone = normalizedPhone(stringValue(body, "phone"));
  if (!fullName || phone.length < 7) return badRequest("Укажите имя и корректный номер телефона");
  const email = optionalString(body, "email");
  const notes = optionalString(body, "notes");
  const existingByPhone = await env.DB.prepare("SELECT id FROM clients WHERE phone = ? LIMIT 1").bind(phone).first<{ id: string }>();
  if (existingByPhone && user.clientId && existingByPhone.id !== user.clientId) return badRequest("Этот номер уже привязан к другой карточке");
  const clientId = user.clientId ?? existingByPhone?.id ?? newId();
  const statements: D1PreparedStatement[] = [];
  if (user.clientId || existingByPhone) {
    statements.push(env.DB.prepare("UPDATE clients SET full_name = ?, phone = ?, email = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(fullName, phone, email, notes, clientId));
  } else {
    statements.push(env.DB.prepare("INSERT INTO clients (id, full_name, phone, email, notes) VALUES (?, ?, ?, ?, ?)").bind(clientId, fullName, phone, email, notes));
  }
  statements.push(env.DB.prepare("UPDATE users SET client_id = ?, phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(clientId, phone, user.id));
  statements.push(env.DB.prepare("INSERT OR IGNORE INTO client_consents (id, client_id, kind, version) VALUES (?, ?, 'PRIVACY', '2026-08-10')").bind(newId(), clientId));
  const allowReminders = body.allowReminders === true || body.allowReminders === "true";
  statements.push(env.DB.prepare("UPDATE users SET notifications_allowed = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(allowReminders ? 1 : 0, user.id));
  if (allowReminders) {
    statements.push(env.DB.prepare("INSERT OR IGNORE INTO client_consents (id, client_id, kind, version, revoked_at) VALUES (?, ?, 'REMINDERS', '2026-08-10', NULL)").bind(newId(), clientId));
    statements.push(env.DB.prepare("UPDATE client_consents SET revoked_at = NULL WHERE client_id = ? AND kind = 'REMINDERS' AND version = '2026-08-10'").bind(clientId));
  } else {
    statements.push(env.DB.prepare("UPDATE client_consents SET revoked_at = CURRENT_TIMESTAMP WHERE client_id = ? AND kind = 'REMINDERS' AND revoked_at IS NULL").bind(clientId));
  }
  await env.DB.batch(statements);
  return json({ ok: true, clientId });
};
