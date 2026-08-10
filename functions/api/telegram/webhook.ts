import type { CrmEnv } from "../../_lib/env";
import { json, readJson } from "../../_lib/http";
import { sendTelegramMessage, telegramApi } from "../../_lib/telegram-bot";

type TelegramMessage = { chat?: { id?: number }; text?: string; from?: { first_name?: string } };
type TelegramCallback = { id?: string; data?: string; message?: TelegramMessage };
type TelegramUpdate = { message?: TelegramMessage; callback_query?: TelegramCallback };

function appUrl(env: CrmEnv, startParam: string) {
  const base = env.MINI_APP_URL || "https://podologymk-crm.pages.dev";
  return `${base.replace(/\/$/, "")}/?startapp=${encodeURIComponent(startParam)}`;
}

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (env.TELEGRAM_WEBHOOK_SECRET && secret !== env.TELEGRAM_WEBHOOK_SECRET) return json({ ok: false, error: "Forbidden" }, 403);
  const update = await readJson(request) as unknown as TelegramUpdate;
  const message = update.message;
  if (message?.chat?.id && message.text) {
    const command = message.text.trim().split(/\s+/)[0].toLowerCase();
    if (["/start", "/book", "/appointments", "/my_appointments"].includes(command)) {
      await sendTelegramMessage(env, String(message.chat.id), `Добро пожаловать в podologymk${message.from?.first_name ? `, ${message.from.first_name}` : ""}!`, {
        inline_keyboard: [
          [{ text: "📅 Записаться", web_app: { url: appUrl(env, "book") } }],
          [{ text: "🗓 Мои записи", web_app: { url: appUrl(env, "appointments") } }, { text: "🎁 Мои бонусы", web_app: { url: appUrl(env, "loyalty") } }],
        ],
      });
    } else if (command === "/help") {
      await sendTelegramMessage(env, String(message.chat.id), "В Mini App можно записаться, перенести или отменить визит, посмотреть бонусы и оставить отзыв.");
    }
  }
  const callback = update.callback_query;
  if (callback?.id) await telegramApi(env, "answerCallbackQuery", { callback_query_id: callback.id });
  return json({ ok: true });
};
