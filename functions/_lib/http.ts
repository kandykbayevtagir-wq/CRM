export type JsonRecord = Record<string, unknown>;

export function json<T>(data: T, status = 200, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

export async function readJson(request: Request): Promise<JsonRecord> {
  try {
    const value: unknown = await request.json();
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as JsonRecord
      : {};
  } catch {
    return {};
  }
}

export function stringValue(body: JsonRecord, key: string, fallback = "") {
  const value = body[key];
  return typeof value === "string" ? value.trim() : fallback;
}

export function optionalString(body: JsonRecord, key: string) {
  const value = body[key];
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value.trim() : null;
}

export function numberValue(body: JsonRecord, key: string, fallback = 0) {
  const value = body[key];
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function dateValue(body: JsonRecord, key: string) {
  const raw = stringValue(body, key);
  if (!raw) return "";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function newId() {
  return crypto.randomUUID();
}

export function newCheckInToken() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
}

export function now() {
  return new Date().toISOString();
}

export function badRequest(message: string) {
  return json({ ok: false, error: message }, 400);
}

export function notFound(message = "Not found") {
  return json({ ok: false, error: message }, 404);
}
