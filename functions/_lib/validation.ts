import { normalizePhone, isValidPhone } from "../../src/lib/validation/phone";
import type { JsonRecord } from "./http";

export function phoneValue(body: JsonRecord, key = "phone", fallback = ""): string {
  const value = typeof body[key] === "string" ? String(body[key]).trim() : fallback;
  return normalizePhone(value);
}

export function requirePhone(value: string): string | null {
  return isValidPhone(value) ? normalizePhone(value) : null;
}

export function optionalPhoneValue(body: JsonRecord, key = "phone") {
  const raw = typeof body[key] === "string" ? String(body[key]).trim() : "";
  if (!raw) return { provided: false, value: null as string | null };
  if (raw.replace(/\s/g, "") === "+7") return { provided: true, value: null as string | null };
  return { provided: true, value: requirePhone(phoneValue(body, key)) };
}

export function nonNegativeNumber(value: unknown, _label: string): number | null {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
}

export function boundedPercent(value: unknown): number | null {
  const number = nonNegativeNumber(value, "Процент");
  return number !== null && number <= 100 ? number : null;
}

export function validDateRange(start: string, end: string): boolean {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return !Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime()) && startDate < endDate;
}
