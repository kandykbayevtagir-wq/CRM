import { forbidden, getSessionUser, isClient, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, json } from "../../_lib/http";
import { findAvailableSlots } from "../../_lib/availability";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isClient(user)) return forbidden();
  const params = new URL(request.url).searchParams;
  const date = params.get("date") ?? "";
  const branchId = params.get("branchId") ?? "";
  const serviceId = params.get("serviceId") ?? "";
  const employeeId = params.get("employeeId") ?? undefined;
  if (!date || !branchId || !serviceId) return badRequest("Дата, филиал и услуга обязательны");
  try {
    const slots = await findAvailableSlots(env.DB, { date, branchId, serviceId, employeeId });
    return json({ ok: true, items: slots });
  } catch (cause) {
    return badRequest(cause instanceof Error ? cause.message : "Не удалось рассчитать свободные окна");
  }
};
