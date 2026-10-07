import type { CrmEnv } from "./env";

export class TelegramApiError extends Error {
  constructor(public status: number, public retryAfter: number | null, message: string) { super(message); }
  get permanent() { return [400, 401, 403, 404].includes(this.status); }
}
type TelegramResponse = { ok: boolean; error_code?: number; description?: string; parameters?: { retry_after?: number }; result?: { message_id?: number } };

export async function telegramApi<T extends TelegramResponse>(env: CrmEnv, method: string, body: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json() as T;
  if (!response.ok || !payload.ok) throw new TelegramApiError(payload.error_code ?? response.status, payload.parameters?.retry_after ?? null, `Telegram ${method}: ${payload.description ?? "request failed"}`);
  return payload;
}

export async function sendTelegramMessage(env: CrmEnv, telegramId: string, text: string, replyMarkup?: Record<string, unknown>) {
  return telegramApi(env, "sendMessage", {
    chat_id: Number(telegramId),
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}
