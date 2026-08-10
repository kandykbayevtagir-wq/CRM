import { forbidden, getSessionUser, isStaff, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { badRequest, json, now, numberValue, readJson, stringValue } from "../_lib/http";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isStaff(user)) return forbidden();
  const settings = await env.DB.prepare(`
    SELECT brand_name AS brandName, currency, timezone,
      booking_start_time AS bookingStartTime, booking_end_time AS bookingEndTime,
      booking_slot_interval AS bookingSlotInterval, working_days AS workingDays,
      cancellation_window_hours AS cancellationWindowHours, loyalty_points_per_1000 AS loyaltyPointsPer1000
    FROM organization_settings WHERE id = 1
  `).first();
  const branches = await env.DB.prepare("SELECT id, name, address, phone, is_active AS isActive FROM branches ORDER BY name ASC").all();
  return json({ ok: true, settings, branches: branches.results ?? [] });
};

export const onRequestPatch: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isStaff(user)) return forbidden();
  const body = await readJson(request);
  const brandName = stringValue(body, "brandName");
  const currency = stringValue(body, "currency", "KZT");
  const timezone = stringValue(body, "timezone", "Asia/Almaty");
  const bookingStartTime = stringValue(body, "bookingStartTime", "09:00");
  const bookingEndTime = stringValue(body, "bookingEndTime", "18:00");
  const bookingSlotInterval = Math.min(120, Math.max(15, numberValue(body, "bookingSlotInterval", 30)));
  const workingDays = stringValue(body, "workingDays", "1,2,3,4,5,6").split(",").map((day) => Number(day.trim())).filter((day) => day >= 1 && day <= 7).join(",") || "1,2,3,4,5,6";
  const cancellationWindowHours = Math.min(72, Math.max(0, numberValue(body, "cancellationWindowHours", 2)));
  const loyaltyPointsPer1000 = Math.min(100, Math.max(0, numberValue(body, "loyaltyPointsPer1000", 1)));
  if (!brandName) return badRequest("Название организации обязательно");
  await env.DB.prepare(`
    UPDATE organization_settings SET brand_name = ?, currency = ?, timezone = ?, booking_start_time = ?, booking_end_time = ?,
      booking_slot_interval = ?, working_days = ?, cancellation_window_hours = ?, loyalty_points_per_1000 = ?, updated_at = ? WHERE id = 1
  `).bind(brandName, currency, timezone, bookingStartTime, bookingEndTime, bookingSlotInterval, workingDays, cancellationWindowHours, loyaltyPointsPer1000, now()).run();
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, entity_type, entity_id, action, after_json) VALUES (?, ?, 'settings', '1', 'UPDATE', ?)")
    .bind(crypto.randomUUID(), user.id, JSON.stringify({ brandName, currency, timezone, bookingStartTime, bookingEndTime, bookingSlotInterval, workingDays, cancellationWindowHours, loyaltyPointsPer1000 })).run();
  return json({ ok: true });
};
