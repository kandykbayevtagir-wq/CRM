import { getSessionUser, forbidden, unauthorized, hasCrmPermission } from "../_lib/auth";
import { getOwnEmployeeId } from "../_lib/access";
import type { CrmEnv } from "../_lib/env";
import { json } from "../_lib/http";

export const onRequestGet: PagesFunction<CrmEnv> = async ({request,env}) => {
  const user = await getSessionUser(request,env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user,"appointments.read")) return forbidden();
  const own = await getOwnEmployeeId(env.DB,user);
  if (user.role === "SPECIALIST" && !own) return json({ok:true,branches:[],employees:[],clients:[],services:[]});
  const [branches,employees,clients,services] = await Promise.all([
    env.DB.prepare(`SELECT id,name,address,phone,is_active AS isActive FROM branches WHERE is_active = 1 ${own ? "AND EXISTS(SELECT 1 FROM employee_branches eb WHERE eb.branch_id = branches.id AND eb.employee_id = ?)" : ""} ORDER BY name`).bind(...(own?[own]:[])).all(),
    env.DB.prepare(`SELECT id,full_name AS fullName,position,branch_id AS branchId FROM employees WHERE is_active = 1 ${own?"AND id = ?":""} ORDER BY full_name`).bind(...(own?[own]:[])).all(),
    env.DB.prepare(`SELECT id,full_name AS fullName,phone FROM clients WHERE is_active = 1 ${own?"AND EXISTS(SELECT 1 FROM appointments a WHERE a.client_id = clients.id AND a.employee_id = ?)":""} ORDER BY full_name LIMIT 200`).bind(...(own?[own]:[])).all(),
    env.DB.prepare(`SELECT id,name,category,price,duration_minutes AS durationMinutes FROM services WHERE is_active = 1 ${own?"AND EXISTS(SELECT 1 FROM employee_services es WHERE es.service_id = services.id AND es.employee_id = ? AND es.active = 1)":""} ORDER BY name`).bind(...(own?[own]:[])).all(),
  ]);
  return json({ok:true,branches:branches.results??[],employees:employees.results??[],clients:clients.results??[],services:services.results??[]});
};
