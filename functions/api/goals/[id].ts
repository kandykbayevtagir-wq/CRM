import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { json, notFound } from "../../_lib/http";

export const onRequestDelete: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "goals.write")) return forbidden();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const result = await env.DB.prepare("DELETE FROM goals WHERE id = ?").bind(id).run();
  if (!result.meta.changes) return notFound("Цель не найдена");
  return json({ ok: true });
};
