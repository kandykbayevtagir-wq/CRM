export const CENTRE_TIMEZONE = "Asia/Almaty";

/**
 * Parses API timestamps tolerantly. Besides ISO-8601, legacy SQLite values
 * ("YYYY-MM-DD HH:MM:SS", UTC) are accepted: Safari rejects that form and
 * Chrome would read it as local time.
 */
export function parseDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") return Number.isNaN(value) ? null : new Date(value);
  const raw = value.trim();
  const legacy = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(raw);
  const date = new Date(legacy ? `${raw.replace(" ", "T")}Z` : raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "KZT",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatCompactCurrency(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(".0", "")} млн`;
  }

  if (value >= 1_000) {
    return `${Math.round(value / 1_000)} тыс.`;
  }

  return formatCurrency(value);
}

export function formatDate(value: string | null | undefined, timeZone = CENTRE_TIMEZONE) {
  const date = parseDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(date);
}

export function formatDateTime(value: string | null | undefined, timeZone = CENTRE_TIMEZONE) {
  const date = parseDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

export function formatTime(value: string | null | undefined, timeZone = CENTRE_TIMEZONE) {
  const date = parseDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone }).format(date);
}

/** "YYYY-MM-DD" of an instant in the centre's timezone (for date inputs and day filters). */
export function dateValueInZone(value: Date | string = new Date(), timeZone = CENTRE_TIMEZONE) {
  const date = parseDate(value) ?? new Date();
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/**
 * "YYYY-MM-DDTHH:mm" wall-clock value in the centre's timezone for datetime-local inputs.
 * The API interprets zone-less values in the same timezone, so the round trip is exact.
 */
export function dateInputValue(value: Date | string = new Date(), timeZone = CENTRE_TIMEZONE) {
  const date = parseDate(value) ?? new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "—";
}

const pluralRules = new Intl.PluralRules("ru-RU");

/** Russian plural: plural(5, ["запись", "записи", "записей"]) → "5 записей". */
export function plural(count: number, forms: readonly [string, string, string], withNumber = true) {
  const category = pluralRules.select(Math.abs(Math.trunc(count)));
  const form = category === "one" ? forms[0] : category === "few" ? forms[1] : forms[2];
  return withNumber ? `${count.toLocaleString("ru-RU")} ${form}` : form;
}

/** True when the page runs inside the Telegram Mini App WebView (print/alert dialogs are unavailable there). */
export function insideTelegram() {
  return typeof window !== "undefined" && Boolean(window.Telegram?.WebApp?.initData);
}
