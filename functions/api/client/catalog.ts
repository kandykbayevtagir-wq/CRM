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
    user.clientId ? env.DB.prepare("SELECT id, full_name AS fullName, phone, email, is_active AS isActive FROM clients WHERE id = ?").bind(user.clientId).first<{ id: string; fullName: string; phone: string; email: string | null; isActive: number }>() : Promise.resolve(null),
  ]);
  // Archived cards cannot book: the portal shows a notice instead of the onboarding form.
  const archived = Boolean(profile && Number(profile.isActive) === 0);
  return json({ ok: true, user: { name: user.name }, profile: archived || !profile ? null : { id: profile.id, fullName: profile.fullName, phone: profile.phone, email: profile.email }, archived, services: services.results ?? [], branches: branches.results ?? [] });
};
