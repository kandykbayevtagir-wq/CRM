import { stringValue } from "./http";
import { boundedPercent, nonNegativeNumber } from "./validation";

export function branchIds(body: Record<string, unknown>): string[] {
  const raw = body.branchIds ?? body.branchId;
  if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim());
  if (typeof raw === "string") return raw.split(",").map((value) => value.trim()).filter(Boolean);
  return [];
}

export function serviceIds(body: Record<string, unknown>): string[] {
  const raw = body.serviceIds ?? body.serviceId;
  if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim());
  if (typeof raw === "string") return raw.split(",").map((value) => value.trim()).filter(Boolean);
  return [];
}

export function employeeValues(body: Record<string, unknown>, existing?: Record<string, unknown>) {
  const fullName = stringValue(body, "fullName", String(existing?.full_name ?? ""));
  const position = stringValue(body, "position", String(existing?.position ?? ""));
  const fixedSalary = nonNegativeNumber(body.fixedSalary ?? existing?.fixed_salary, "Фикс") ?? -1;
  const revenuePercent = boundedPercent(body.revenuePercent ?? existing?.revenue_percent) ?? -1;
  return { fullName, position, fixedSalary, revenuePercent };
}
