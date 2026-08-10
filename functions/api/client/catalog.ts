import { forbidden, getSessionUser, isClient, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { json } from "../../_lib/http";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isClient(user)) return forbidden();
  const [services, branches, profile] = await Promise.all([
    env.DB.prepare("SELECT id, name, category, price, duration_minutes AS durationMinutes, is_active AS isActive FROM services WHERE is_active = 1 ORDER BY category ASC, name ASC").all(),
    env.DB.prepare("SELECT id, name, address, phone, is_active AS isActive FROM branches WHERE is_active = 1 ORDER BY name ASC").all(),
    user.clientId ? env.DB.prepare("SELECT id, full_name AS fullName, phone, email FROM clients WHERE id = ?").bind(user.clientId).first() : Promise.resolve(null),
  ]);
  return json({ ok: true, profile, services: services.results ?? [], branches: branches.results ?? [] });
};
