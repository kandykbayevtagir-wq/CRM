"use client";

import { useEffect } from "react";

import { dispatchCrmEvent } from "@/lib/api-client";

export function TelegramMiniApp() {
  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp) return;

    webApp.ready();
    webApp.expand();
    webApp.setHeaderColor("#f7f8fb");
    webApp.setBackgroundColor("#f7f8fb");

    if (webApp.initData) {
      void fetch("/api/telegram/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ initData: webApp.initData }),
      }).then((response) => {
        if (response.ok) dispatchCrmEvent("crm:authenticated");
      }).catch(() => undefined);
    }
  }, []);

  return null;
}
