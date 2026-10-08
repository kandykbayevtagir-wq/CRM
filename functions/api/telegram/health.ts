import type { CrmEnv } from "../../_lib/env";

// Configuration details are not disclosed to anonymous callers; a bare liveness answer is enough for monitoring.
export const onRequestGet: PagesFunction<CrmEnv> = () => Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
