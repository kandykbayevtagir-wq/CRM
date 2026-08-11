export type CrmEnv = Env & {
  TELEGRAM_BOT_TOKEN: string;
  CRM_ALLOWED_TELEGRAM_IDS: string;
  CRM_OWNER_TELEGRAM_ID?: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  MINI_APP_URL: string;
};
