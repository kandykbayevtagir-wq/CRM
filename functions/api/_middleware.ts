import { getSessionUser, forbidden, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { isStaffTelegramAllowed } from "../../src/lib/auth/bootstrap";
import { HttpError, errorResponse, validateRequestOrigin } from "../_lib/security";

// Logout must work without a valid session so a stale or revoked cookie can always be cleared.
const publicPaths = new Set(["/api/health", "/api/telegram/health", "/api/telegram/auth", "/api/telegram/webhook", "/api/auth/logout"]);

export const onRequest: PagesFunction<CrmEnv> = async (context) => {
  const { request, env } = context;
  const requestId = crypto.randomUUID();
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  let userId: string | null = null;
  let response: Response;
  try {
    if (path !== "/api/telegram/webhook") validateRequestOrigin(request);
    if (Number(request.headers.get("content-length") || 0) > 131072) throw new HttpError(413, "BODY_TOO_LARGE", "Слишком большой запрос");
    if (!publicPaths.has(path)) {
      const user = await getSessionUser(request, env.DB);
      userId = user?.id ?? null;
      if (!user) response = unauthorized();
      else if (!isStaffTelegramAllowed(user.role, user.telegramId, (env.CRM_ALLOWED_TELEGRAM_IDS || "").split(",").map((id) => id.trim()).filter(Boolean), env.CRM_OWNER_TELEGRAM_ID || "")) response = forbidden();
      else response = await context.next();
    } else {
      if (path === "/api/telegram/auth" && request.method === "POST") {
        const ip = request.headers.get("cf-connecting-ip") || "local";
        const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
        const key = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
        const bucket = Math.floor(Date.now() / 60000);
        const row = await env.DB.prepare(`INSERT INTO auth_rate_limits (key, bucket, attempts) VALUES (?, ?, 1)
          ON CONFLICT(key) DO UPDATE SET bucket = excluded.bucket, attempts = CASE WHEN bucket = excluded.bucket THEN attempts + 1 ELSE 1 END RETURNING attempts`)
          .bind(key, bucket).first<{ attempts: number }>();
        if ((row?.attempts ?? 0) > 30) throw new HttpError(429, "RATE_LIMITED", "Слишком много попыток входа. Попробуйте через минуту.");
        context.waitUntil(env.DB.prepare("DELETE FROM auth_rate_limits WHERE bucket < ?").bind(bucket - 60).run());
      }
      response = await context.next();
    }
  } catch (error) {
    response = errorResponse(error, requestId);
    if (response.status >= 500) console.error(JSON.stringify({ event: "api_error", requestId, userId, endpoint: path, errorCode: "INTERNAL_ERROR" }));
  }
  const secured = new Response(response.body, response);
  secured.headers.set("x-request-id", requestId);
  secured.headers.set("x-content-type-options", "nosniff");
  secured.headers.set("cache-control", "no-store");
  secured.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  if (secured.status === 429) secured.headers.set("retry-after", "60");
  return secured;
};
