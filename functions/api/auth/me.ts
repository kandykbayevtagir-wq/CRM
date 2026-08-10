import { getSessionUser, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { json } from "../../_lib/http";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  return json({ ok: true, user });
};
