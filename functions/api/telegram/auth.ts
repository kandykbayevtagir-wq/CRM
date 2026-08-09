import { validateTelegramInitData } from "../../_lib/telegram";

type TelegramEnv = {
  TELEGRAM_BOT_TOKEN?: string;
};

type PagesContext = {
  request: Request;
  env: TelegramEnv;
};

export const onRequestPost = async ({ request, env }: PagesContext) => {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return Response.json({ ok: false, error: "Telegram secret is not configured" }, { status: 503 });
  }

  let payload: { initData?: string };
  try {
    payload = await request.json() as { initData?: string };
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (!payload.initData) {
    return Response.json({ ok: false, error: "initData is required" }, { status: 400 });
  }

  const verified = await validateTelegramInitData(payload.initData, env.TELEGRAM_BOT_TOKEN);
  if (!verified) {
    return Response.json({ ok: false, error: "Invalid Telegram initData" }, { status: 401 });
  }

  return Response.json({ ok: true, user: verified.user ?? null });
};
