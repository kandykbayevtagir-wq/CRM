import { clearedSessionCookie, destroySession } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { json } from "../../_lib/http";

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  await destroySession(request, env.DB);
  return json({ ok: true }, 200, { "set-cookie": clearedSessionCookie() });
};
