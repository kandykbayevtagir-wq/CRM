import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, json, newId, optionalString, readJson, stringValue } from "../_lib/http";

type ClientMetric = { id: string; fullName: string; phone: string; createdAt: string; visits: number; revenue: number; averageCheck: number; lastVisit: string | null; cancellations: number; noShows: number };

function segmentMatch(segment: string, item: ClientMetric, now = Date.now()) {
  const daysSinceVisit = item.lastVisit ? Math.floor((now - new Date(item.lastVisit).getTime()) / 86_400_000) : 9999;
  if (segment === "new") return item.visits === 1;
  if (segment === "regular") return item.visits >= 3;
  if (segment === "vip") return item.revenue >= 150000 || item.averageCheck >= 30000;
  if (segment === "inactive30") return daysSinceVisit >= 30;
  if (segment === "inactive60") return daysSinceVisit >= 60;
  if (segment === "inactive90") return daysSinceVisit >= 90;
  if (segment === "one_time") return item.visits === 1 && daysSinceVisit >= 30;
  if (segment === "cancel_risk") return item.cancellations >= 2;
  if (segment === "no_show_risk") return item.noShows >= 1;
  if (segment === "high_check") return item.averageCheck >= 30000;
  if (segment === "inactive") return daysSinceVisit >= 180 || item.visits === 0;
  return true;
}

async function clientMetrics(db: D1Database) {
  const rows = await db.prepare(`SELECT c.id, c.full_name AS fullName, c.phone, c.created_at AS createdAt,
    COUNT(DISTINCT CASE WHEN a.status = 'COMPLETED' THEN a.id END) AS visits,
    COALESCE((SELECT SUM(p.amount) FROM payments p INNER JOIN appointments pa ON pa.id = p.appointment_id WHERE pa.client_id = c.id AND p.payment_status = 'POSTED'), 0)
      - COALESCE((SELECT SUM(pa2.amount) FROM payment_adjustments pa2 INNER JOIN payments rp ON rp.id = pa2.payment_id INNER JOIN appointments ra ON ra.id = rp.appointment_id WHERE ra.client_id = c.id), 0) AS revenue,
    MAX(CASE WHEN a.status = 'COMPLETED' THEN a.starts_at END) AS lastVisit,
    SUM(CASE WHEN a.status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancellations,
    SUM(CASE WHEN a.status = 'NO_SHOW' THEN 1 ELSE 0 END) AS noShows
    FROM clients c LEFT JOIN appointments a ON a.client_id = c.id WHERE c.is_active = 1 GROUP BY c.id ORDER BY lastVisit DESC`).all<{ id: string; fullName: string; phone: string; createdAt: string; visits: number; revenue: number; lastVisit: string | null; cancellations: number; noShows: number }>();
  return (rows.results ?? []).map((row) => ({ ...row, visits: Number(row.visits ?? 0), revenue: Number(row.revenue ?? 0), averageCheck: Number(row.visits ?? 0) ? Number(row.revenue ?? 0) / Number(row.visits) : 0, cancellations: Number(row.cancellations ?? 0), noShows: Number(row.noShows ?? 0) } satisfies ClientMetric));
}

const systemSegments = [
  ["new", "Новые клиенты", "Первый завершённый визит"], ["regular", "Постоянные", "Три и более завершённых визита"], ["vip", "VIP", "Высокая сумма визитов или средний чек"], ["inactive30", "Не был 30 дней", "Последний визит 30+ дней назад"], ["inactive60", "Не был 60 дней", "Последний визит 60+ дней назад"], ["inactive90", "Не был 90+ дней", "Последний визит 90+ дней назад"], ["one_time", "Был один раз", "Один визит и не вернулся"], ["cancel_risk", "Часто отменяет", "Две и более отмены"], ["no_show_risk", "No-show risk", "Есть пропущенный визит"], ["high_check", "Высокий средний чек", "Средний чек от 30 000 ₸"], ["inactive", "Неактивные", "Нет визита 180+ дней или визитов не было"],
] as const;

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "retention.read")) return forbidden();
  const metrics = await clientMetrics(env.DB);
  const params = new URL(request.url).searchParams;
  const selected = params.get("segment")?.trim() || "";
  const system = systemSegments.map(([key, name, description]) => ({ id: key, name, description, system: true, count: metrics.filter((item) => segmentMatch(key, item)).length }));
  const customRows = await env.DB.prepare("SELECT id, name, description, criteria_json AS criteriaJson, created_at AS createdAt FROM client_segments WHERE is_active = 1 ORDER BY name").all<{ id: string; name: string; description: string | null; criteriaJson: string; createdAt: string }>();
  const custom = (customRows.results ?? []).map((segment) => {
    let criteria: Record<string, unknown> = {};
    try { criteria = JSON.parse(segment.criteriaJson) as Record<string, unknown>; } catch { criteria = {}; }
    const filtered = metrics.filter((item) => (criteria.minVisits === undefined || item.visits >= Number(criteria.minVisits)) && (criteria.maxDaysSinceVisit === undefined || (item.lastVisit ? (Date.now() - new Date(item.lastVisit).getTime()) / 86_400_000 : 9999) <= Number(criteria.maxDaysSinceVisit)) && (criteria.minRevenue === undefined || item.revenue >= Number(criteria.minRevenue)));
    return { id: segment.id, name: segment.name, description: segment.description, system: false, count: filtered.length, criteria };
  });
  const segment = system.find((item) => item.id === selected) ?? custom.find((item) => item.id === selected);
  let clients = metrics;
  if (selected && systemSegments.some(([key]) => key === selected)) clients = metrics.filter((item) => segmentMatch(selected, item));
  if (segment && !segment.system) {
    const criteria = (segment as { criteria: Record<string, unknown> }).criteria;
    clients = metrics.filter((item) => (criteria.minVisits === undefined || item.visits >= Number(criteria.minVisits)) && (criteria.maxDaysSinceVisit === undefined || (item.lastVisit ? (Date.now() - new Date(item.lastVisit).getTime()) / 86_400_000 : 9999) <= Number(criteria.maxDaysSinceVisit)) && (criteria.minRevenue === undefined || item.revenue >= Number(criteria.minRevenue)));
  }
  return json({ ok: true, segments: [...system, ...custom], selectedSegment: selected || null, clients: clients.slice(0, 500) });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "retention.write")) return forbidden();
  const body = await readJson(request);
  const name = stringValue(body, "name");
  const criteria = body.criteria && typeof body.criteria === "object" ? body.criteria : {};
  if (!name) return badRequest("Название сегмента обязательно");
  const id = newId();
  await env.DB.prepare("INSERT INTO client_segments (id, name, description, criteria_json, created_by) VALUES (?, ?, ?, ?, ?)").bind(id, name, optionalString(body, "description"), JSON.stringify(criteria), user.id).run();
  return json({ ok: true, id }, 201);
};
