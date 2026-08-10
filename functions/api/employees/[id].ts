import { getSessionUser, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { json, newId, notFound, optionalString, numberValue, readJson, stringValue } from "../../_lib/http";

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  const existing = await env.DB.prepare("SELECT * FROM employees WHERE id = ?").bind(params.id).first();
  if (!existing) return notFound("Сотрудник не найден");
  const body = await readJson(request);
  await env.DB.prepare(`
    UPDATE employees SET full_name = ?, position = ?, phone = ?, email = ?, branch_id = ?, fixed_salary = ?, revenue_percent = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(
    stringValue(body, "fullName", String(existing.full_name ?? "")),
    stringValue(body, "position", String(existing.position ?? "")),
    optionalString(body, "phone") ?? existing.phone ?? null,
    optionalString(body, "email") ?? existing.email ?? null,
    optionalString(body, "branchId") ?? existing.branch_id ?? null,
    numberValue(body, "fixedSalary", Number(existing.fixed_salary ?? 0)),
    numberValue(body, "revenuePercent", Number(existing.revenue_percent ?? 0)),
    params.id,
  ).run();
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action) VALUES (?, ?, 'employee', ?, 'UPDATE')")
    .bind(newId(), user.id, params.id).run();
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<CrmEnv> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  const result = await env.DB.prepare("UPDATE employees SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(params.id).run();
  if (!result.success || result.meta.changes === 0) return notFound("Сотрудник не найден");
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action) VALUES (?, ?, 'employee', ?, 'ARCHIVE')")
    .bind(newId(), user.id, params.id).run();
  return json({ ok: true });
};
