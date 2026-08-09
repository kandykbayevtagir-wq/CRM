type TelegramEnv = {
  TELEGRAM_BOT_TOKEN?: string;
};

type PagesContext = {
  env: TelegramEnv;
};

export const onRequestGet = ({ env }: PagesContext) => Response.json({
  ok: true,
  telegramSecretConfigured: Boolean(env.TELEGRAM_BOT_TOKEN),
});
