import { closePayrollPeriod } from "../../_lib/payroll";
import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { badRequest, json, readJson, stringValue } from "../../_lib/http";

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "payroll.write")) return forbidden();
  const body = await readJson(request);
  const periodId = stringValue(body, "periodId");
  if (!periodId) return badRequest("Расчётный период не указан");
  try {
    return json({ ok: true, result: await closePayrollPeriod(env.DB, periodId, user) });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Не удалось закрыть зарплатный период");
  }
};
