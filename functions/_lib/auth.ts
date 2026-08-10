import { json } from "./http";

const SESSION_COOKIE = "pmk_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export type AuthUser = {
  id: string;
  telegramId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  role: string;
  clientId: string | null;
  phone: string | null;
  notificationsAllowed: number;
};

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const cookie of cookieHeader.split(";")) {
    const [key, ...value] = cookie.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

export async function getSessionUser(request: Request, db: D1Database): Promise<AuthUser | null> {
  const rawToken = getCookie(request, SESSION_COOKIE);
  if (!rawToken) return null;

  const tokenHash = await sha256Hex(rawToken);
  const row = await db.prepare(`
    SELECT u.id, u.telegram_id AS telegramId, u.name, u.username, u.avatar_url AS avatarUrl, u.role,
      u.client_id AS clientId, u.phone, u.notifications_allowed AS notificationsAllowed
    FROM sessions s
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP
    LIMIT 1
  `).bind(tokenHash).first<AuthUser>();

  return row ?? null;
}

export function unauthorized() {
  return json({ ok: false, error: "Telegram authorization required" }, 401);
}

export function forbidden(message = "Недостаточно прав для этой операции") {
  return json({ ok: false, error: message }, 403);
}

export function isStaff(user: AuthUser | null): user is AuthUser {
  return Boolean(user && user.role !== "CLIENT");
}

export function isClient(user: AuthUser | null): user is AuthUser {
  return Boolean(user && user.role === "CLIENT");
}

export async function createSession(db: D1Database, userId: string) {
  const rawToken = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(tokenHash, userId, expiresAt)
    .run();
  return rawToken;
}

export function sessionCookie(rawToken: string) {
  return `${SESSION_COOKIE}=${encodeURIComponent(rawToken)}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

export async function destroySession(request: Request, db: D1Database) {
  const rawToken = getCookie(request, SESSION_COOKIE);
  if (!rawToken) return;
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(rawToken)).run();
}

export function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
