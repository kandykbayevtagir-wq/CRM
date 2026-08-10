export type CrmEnv = Env & {
  TELEGRAM_BOT_TOKEN: string;
  CRM_ALLOWED_TELEGRAM_IDS: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  MINI_APP_URL: string;
};
