const token = process.env.TELEGRAM_BOT_TOKEN;
const miniAppUrl = process.env.MINI_APP_URL;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!token || !miniAppUrl) {
  console.error("Set TELEGRAM_BOT_TOKEN and MINI_APP_URL before running this script.");
  process.exit(1);
}

async function telegram(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(`${method}: ${result.description ?? "Telegram API error"}`);
  return result;
}

await telegram("setChatMenuButton", {
  menu_button: {
    type: "web_app",
    text: "Открыть CRM",
    web_app: { url: miniAppUrl },
  },
});

if (chatId) {
  await telegram("setChatMenuButton", {
    chat_id: Number(chatId),
    menu_button: {
      type: "web_app",
      text: "Открыть CRM",
      web_app: { url: miniAppUrl },
    },
  });
}

await telegram("setMyCommands", {
  commands: [
    { command: "start", description: "Открыть CRM" },
    { command: "help", description: "Помощь" },
  ],
});

console.log(`Telegram Mini App configured: ${miniAppUrl}`);
