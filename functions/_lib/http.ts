import { HttpError } from "./security";

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
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new HttpError(415, "JSON_REQUIRED", "Ожидается JSON-запрос");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "INVALID_JSON", "Тело запроса отсутствует");
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 131072) { await reader.cancel(); throw new HttpError(413, "BODY_TOO_LARGE", "Слишком большой запрос"); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
    return value as JsonRecord;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Некорректный JSON-запрос");
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

export function badRequest(message: string, fieldErrors?: Record<string, string>) {
  return json({ ok: false, error: message, ...(fieldErrors ? { fieldErrors } : {}) }, 400);
}

export function conflict(message: string) {
  return json({ ok: false, error: message }, 409);
}

export function notFound(message = "Not found") {
  return json({ ok: false, error: message }, 404);
}
