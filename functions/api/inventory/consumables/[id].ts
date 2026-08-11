import { auditStatement } from "../../../_lib/audit";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../../_lib/auth";
import type { CrmEnv } from "../../../_lib/env";
import { json, notFound } from "../../../_lib/http";

export const onRequestDelete: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "inventory.write")) return forbidden();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const existing = await env.DB.prepare("SELECT id FROM service_consumables WHERE id = ? AND active = 1").bind(id).first();
  if (!existing) return notFound("Расходник не найден");
  await env.DB.batch([
    env.DB.prepare("UPDATE service_consumables SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id),
    auditStatement(env.DB, user, "service_consumable", id, "ARCHIVE", { active: 1 }, { active: 0 }),
  ]);
  return json({ ok: true });
};
