import { localDate, localDayRange } from "../../src/lib/appointments/schedule";
import { stringValue, type JsonRecord } from "./http";

export const DEFAULT_TIMEZONE = "Asia/Almaty";

/** SQL expression producing the canonical ISO-8601 UTC form of a stored timestamp (legacy "YYYY-MM-DD HH:MM:SS" or ISO). */
export const SQL_NOW_ISO = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
export function isoColumn(column: string) {
  return `strftime('%Y-%m-%dT%H:%M:%fZ', ${column})`;
}

/** `[from, to)` predicate for two ISO bindings; julianday() keeps legacy "YYYY-MM-DD HH:MM:SS" rows comparable. */
export function inRange(column: string) {
  return `julianday(${column}) >= julianday(?) AND julianday(${column}) < julianday(?)`;
}

/** Signed offset of the organisation timezone in minutes on the given calendar day. */
export function timezoneOffsetMinutes(date: string, timezone: string) {
  const offset = timezoneOffset(date, timezone);
  const sign = offset.startsWith("-") ? -1 : 1;
  const [hours, minutes] = offset.slice(1).split(":").map(Number);
  return sign * (hours * 60 + minutes);
}

/** SQL expression bucketing a timestamp into the organisation-local calendar day (offset taken at `from`). */
export function localDayExpression(column: string, from: string, timezone: string) {
  return `date(julianday(${column}) + ${(timezoneOffsetMinutes(from.slice(0, 10), timezone) / 1440).toFixed(6)})`;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ZONELESS_DATETIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/;
const LEGACY_SQLITE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,3})?$/;

export function isValidCalendarDate(value: string) {
  if (!DATE_ONLY.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Offset of the organisation timezone on the given calendar day, e.g. "+05:00". */
export function timezoneOffset(date: string, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(`${date}T12:00:00.000Z`));
    const value = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+05:00";
    if (value === "GMT") return "+00:00";
    const match = value.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
    return match ? `${match[1]}${match[2].padStart(2, "0")}:${match[3] ?? "00"}` : "+05:00";
  } catch {
    return "+05:00";
  }
}

/** ISO instant for a wall-clock minute of a calendar day in the organisation timezone. */
export function isoAt(date: string, minutes: number, timezone: string) {
  const hours = Math.floor(minutes / 60).toString().padStart(2, "0");
  const remainder = (minutes % 60).toString().padStart(2, "0");
  return new Date(`${date}T${hours}:${remainder}:00${timezoneOffset(date, timezone)}`).toISOString();
}

/**
 * Canonical ISO form of any stored or submitted timestamp.
 * Legacy SQLite values ("YYYY-MM-DD HH:MM:SS") are UTC, like CURRENT_TIMESTAMP.
 * Returns "" for empty or unparsable input.
 */
export function normalizeIso(value: unknown): string {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw) return "";
  const candidate = LEGACY_SQLITE.test(raw) ? `${raw.replace(" ", "T")}Z` : raw;
  const time = Date.parse(candidate);
  return Number.isNaN(time) ? "" : new Date(time).toISOString();
}

/**
 * Interpret a submitted date/time as an instant. Zone-less values (HTML datetime-local
 * "YYYY-MM-DDTHH:mm") are wall-clock time in the organisation timezone; date-only values
 * are local midnight; anything with an explicit zone is taken as-is.
 */
export function zonedInstant(raw: string, timezone = DEFAULT_TIMEZONE): string {
  const value = raw.trim();
  if (!value) return "";
  if (DATE_ONLY.test(value)) return isValidCalendarDate(value) ? localDayRange(value, timezone).from : "";
  const local = value.match(ZONELESS_DATETIME);
  if (local) {
    const [, date, hours, minutes, seconds] = local;
    if (!isValidCalendarDate(date) || Number(hours) > 23 || Number(minutes) > 59) return "";
    const instant = new Date(`${date}T${hours}:${minutes}:${(seconds ?? "00").padStart(2, "0")}${timezoneOffset(date, timezone)}`);
    return Number.isNaN(instant.getTime()) ? "" : instant.toISOString();
  }
  return normalizeIso(value);
}

export function zonedDateValue(body: JsonRecord, key: string, timezone = DEFAULT_TIMEZONE) {
  return zonedInstant(stringValue(body, key), timezone);
}

function shiftCalendarDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** [from, to) of the organisation-local calendar month containing `now`. */
export function localMonthRange(timezone = DEFAULT_TIMEZONE, now = new Date()) {
  const today = localDate(now, timezone);
  const monthStart = `${today.slice(0, 7)}-01`;
  const nextMonth = new Date(`${monthStart}T12:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  return { key: today.slice(0, 7), from: localDayRange(monthStart, timezone).from, to: localDayRange(nextMonth.toISOString().slice(0, 10), timezone).from };
}

/** [from, to) of the organisation-local calendar day containing `now`. */
export function localTodayRange(timezone = DEFAULT_TIMEZONE, now = new Date()) {
  return localDayRange(localDate(now, timezone), timezone);
}

/**
 * Resolve a reporting period. Date-only values are organisation-local calendar days
 * (the `to` day is inclusive); explicit instants are used as-is; missing or invalid
 * values fall back to the current local month. The result always satisfies from < to.
 */
export function periodRange(fromRaw: string | null | undefined, toRaw: string | null | undefined, timezone = DEFAULT_TIMEZONE, now = new Date()) {
  const fallback = localMonthRange(timezone, now);
  const fromValue = (fromRaw ?? "").trim();
  const toValue = (toRaw ?? "").trim();
  const from = fromValue ? (DATE_ONLY.test(fromValue) ? (isValidCalendarDate(fromValue) ? localDayRange(fromValue, timezone).from : "") : normalizeIso(fromValue)) || fallback.from : fallback.from;
  let to = toValue ? (DATE_ONLY.test(toValue) ? (isValidCalendarDate(toValue) ? localDayRange(toValue, timezone).to : "") : normalizeIso(toValue)) || fallback.to : fallback.to;
  if (Date.parse(to) <= Date.parse(from)) to = localDayRange(shiftCalendarDate(localDate(from, timezone), 0), timezone).to;
  return { from, to };
}

export async function organizationTimezone(db: D1Database) {
  const row = await db.prepare("SELECT timezone FROM organization_settings WHERE id = 1").first<{ timezone: string | null }>();
  return row?.timezone || DEFAULT_TIMEZONE;
}
