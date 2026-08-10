import type { CrmEnv } from "../../_lib/env";

export const onRequestGet: PagesFunction<CrmEnv> = ({ env }) => Response.json({
  ok: true,
  telegramSecretConfigured: Boolean(env.TELEGRAM_BOT_TOKEN),
  databaseConfigured: Boolean(env.DB),
});
