import { getSessionUser, isClient, forbidden, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { notFound } from "../../_lib/http";
import { visitCalendar } from "../../../src/lib/calendar";
import { isoColumn } from "../../_lib/dates";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isClient(user)) return forbidden();
  const id = new URL(request.url).searchParams.get("appointmentId") || "";
  const visit = await env.DB.prepare(`SELECT a.id, a.revision AS sequence, ${isoColumn("a.starts_at")} AS startsAt, ${isoColumn("COALESCE(a.ends_at, datetime(a.starts_at,'+60 minutes'))")} AS endsAt,
    COALESCE(b.name, '') AS branchName, COALESCE(b.address, '') AS address,
    COALESCE((SELECT group_concat(s.name, ', ') FROM appointment_services aps JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id), 'Приём в podologymk') AS serviceName
    FROM appointments a LEFT JOIN branches b ON b.id = a.branch_id WHERE a.id = ? AND a.client_id = ? AND a.status NOT IN ('CANCELLED','NO_SHOW')`)
    .bind(id, user.clientId ?? "__none__").first<{ id: string; sequence: number; startsAt: string; endsAt: string; branchName: string; address: string; serviceName: string }>();
  if (!visit) return notFound();
  return new Response(visitCalendar(visit), { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="podologymk-visit.ics"', "cache-control": "no-store" } });
};
