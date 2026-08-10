import { getSessionUser, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { json, newId, notFound, readJson, numberValue, optionalString, stringValue, dateValue } from "../../_lib/http";

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  const existing = await env.DB.prepare("SELECT * FROM expenses WHERE id = ?").bind(params.id).first();
  if (!existing) return notFound("Операция не найдена");
  const body = await readJson(request);
  await env.DB.prepare(`
    UPDATE expenses SET title = ?, category = ?, branch_id = ?, amount = ?, occurred_at = ?, status = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(
    stringValue(body, "title", String(existing.title ?? "")),
    stringValue(body, "category", String(existing.category ?? "")),
    optionalString(body, "branchId") ?? existing.branch_id ?? null,
    numberValue(body, "amount", Number(existing.amount ?? 0)),
    dateValue(body, "occurredAt") || existing.occurred_at,
    stringValue(body, "status", String(existing.status ?? "PAID")).toUpperCase() === "PLANNED" ? "PLANNED" : "PAID",
    optionalString(body, "description") ?? existing.description ?? null,
    params.id,
  ).run();
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action) VALUES (?, ?, 'expense', ?, 'UPDATE')")
    .bind(newId(), user.id, params.id).run();
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  const result = await env.DB.prepare("DELETE FROM expenses WHERE id = ?").bind(params.id).run();
  if (!result.success || result.meta.changes === 0) return notFound("Операция не найдена");
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action) VALUES (?, ?, 'expense', ?, 'DELETE')")
    .bind(newId(), user.id, params.id).run();
  return json({ ok: true });
};
