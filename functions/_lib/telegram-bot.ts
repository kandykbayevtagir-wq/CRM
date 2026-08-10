import type { CrmEnv } from "./env";

type TelegramResponse = { ok: boolean; description?: string };

export async function telegramApi<T extends TelegramResponse>(env: CrmEnv, method: string, body: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as T;
  if (!response.ok || !payload.ok) throw new Error(payload.description ?? `Telegram ${method} failed`);
  return payload;
}

export async function sendTelegramMessage(env: CrmEnv, telegramId: string, text: string, replyMarkup?: Record<string, unknown>) {
  return telegramApi(env, "sendMessage", {
    chat_id: Number(telegramId),
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}
