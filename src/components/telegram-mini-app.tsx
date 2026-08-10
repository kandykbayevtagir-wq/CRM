"use client";

import { useEffect } from "react";

import { dispatchCrmEvent } from "@/lib/api-client";

export function TelegramMiniApp() {
  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp) return;

    const applyTelegramTheme = () => {
      const root = document.documentElement;
      const theme = webApp.themeParams ?? {};
      root.style.setProperty("--tg-bg", theme.bg_color ?? "#f7f8fb");
      root.style.setProperty("--tg-surface", theme.secondary_bg_color ?? "#ffffff");
      root.style.setProperty("--tg-text", theme.text_color ?? "#22212b");
      root.style.setProperty("--tg-hint", theme.hint_color ?? "#6f707c");
      const safeArea = webApp.safeAreaInset ?? {};
      const contentArea = webApp.contentSafeAreaInset ?? {};
      root.style.setProperty("--tg-safe-top", `${Math.max(safeArea.top ?? 0, contentArea.top ?? 0)}px`);
      root.style.setProperty("--tg-safe-bottom", `${Math.max(safeArea.bottom ?? 0, contentArea.bottom ?? 0)}px`);
    };

    webApp.ready();
    webApp.expand();
    webApp.setHeaderColor("#f7f8fb");
    webApp.setBackgroundColor("#f7f8fb");
    webApp.setBottomBarColor?.("#ffffff");
    webApp.disableVerticalSwipes?.();
    applyTelegramTheme();
    webApp.onEvent?.("themeChanged", applyTelegramTheme);

    if (webApp.initData) {
      void fetch("/api/telegram/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ initData: webApp.initData }),
      }).then((response) => {
        if (response.ok) dispatchCrmEvent("crm:authenticated");
      }).catch(() => undefined);
    }

    return () => webApp.offEvent?.("themeChanged", applyTelegramTheme);
  }, []);

  return null;
}
