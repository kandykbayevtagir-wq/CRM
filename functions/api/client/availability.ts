import { forbidden, getSessionUser, isClient, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, json } from "../../_lib/http";
import { findAvailableSlots } from "../../_lib/availability";

function nextDate(value: string, offset: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isClient(user)) return forbidden();
  const params = new URL(request.url).searchParams;
  const date = params.get("date") ?? "";
  const branchId = params.get("branchId") ?? "";
  const serviceId = params.get("serviceId") ?? "";
  const employeeId = params.get("employeeId") ?? undefined;
  const includeNext = params.get("includeNext") === "1";
  if (!date || !branchId || !serviceId) return badRequest("Дата, филиал и услуга обязательны");
  try {
    const slots = await findAvailableSlots(env.DB, { date, branchId, serviceId, employeeId });
    if (slots.length || !includeNext) return json({ ok: true, items: slots });
    for (let offset = 1; offset <= 14; offset += 1) {
      const next = await findAvailableSlots(env.DB, { date: nextDate(date, offset), branchId, serviceId, employeeId });
      if (next[0]) return json({ ok: true, items: slots, next: next[0] });
    }
    return json({ ok: true, items: slots, next: null });
  } catch (cause) {
    return badRequest(cause instanceof Error ? cause.message : "Не удалось рассчитать свободные окна");
  }
};
