import type { CrmEnv } from "../_lib/env";
import { APP_VERSION } from "../../src/lib/release";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ env }) => {
  const startedAt = Date.now();
  try {
    const result = await env.DB.prepare("SELECT 1 AS ok, (SELECT idempotency_key FROM mutation_receipts LIMIT 1) AS schema_probe").first<{ ok: number }>();
    if (result?.ok !== 1) throw new Error("D1 health query returned an unexpected value");
    return Response.json({ ok: true, version: APP_VERSION, schema: "0013", service: "podologymk-crm", database: "ok", latencyMs: Date.now() - startedAt, timestamp: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false, service: "podologymk-crm", database: "error", latencyMs: Date.now() - startedAt, timestamp: new Date().toISOString() }, { status: 503, headers: { "cache-control": "no-store" } });
  }
};
