"use client";

import { useEffect } from "react";

import { dispatchCrmEvent } from "@/lib/api-client";

export function TelegramMiniApp() {
  useEffect(() => {
    let cancelled = false;
    let authInFlight = false;
    let activeWebApp: TelegramWebApp | null = null;
    let themeHandler: (() => void) | null = null;

    const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

    const waitForWebApp = async () => {
      for (let attempt = 0; attempt < 60 && !cancelled; attempt += 1) {
        const webApp = window.Telegram?.WebApp;
        if (webApp) return webApp;
        await wait(100);
      }
      return null;
    };

    const waitForInitData = async (webApp: TelegramWebApp) => {
      for (let attempt = 0; attempt < 50 && !cancelled; attempt += 1) {
        const initData = webApp.initData?.trim();
        if (initData) return initData;
        await wait(100);
      }
      return "";
    };

    const applyTelegramTheme = (webApp: TelegramWebApp) => {
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
      root.style.setProperty("--tg-safe-area-inset-top", `${safeArea.top ?? 0}px`);
      root.style.setProperty("--tg-safe-area-inset-bottom", `${safeArea.bottom ?? 0}px`);
      root.style.setProperty("--tg-content-safe-area-inset-top", `${contentArea.top ?? 0}px`);
      root.style.setProperty("--tg-content-safe-area-inset-bottom", `${contentArea.bottom ?? 0}px`);
    };

    const configure = (webApp: TelegramWebApp) => {
      activeWebApp = webApp;
      webApp.ready();
      webApp.expand();
      webApp.setHeaderColor("#f7f8fb");
      webApp.setBackgroundColor("#f7f8fb");
      webApp.setBottomBarColor?.("#ffffff");
      webApp.disableVerticalSwipes?.();
      applyTelegramTheme(webApp);
      themeHandler = () => applyTelegramTheme(webApp);
      webApp.onEvent?.("themeChanged", themeHandler);
    };

    const authenticate = async () => {
      if (authInFlight || cancelled) return;
      authInFlight = true;
      try {
        const webApp = activeWebApp ?? await waitForWebApp();
        if (!webApp || cancelled) return;
        if (!activeWebApp) configure(webApp);
        const initData = await waitForInitData(webApp);
        if (!initData || cancelled) return;

        for (let attempt = 0; attempt < 3 && !cancelled; attempt += 1) {
          try {
            const response = await fetch("/api/telegram/auth", {
              method: "POST",
              headers: { "content-type": "application/json" },
              credentials: "include",
              cache: "no-store",
              body: JSON.stringify({ initData }),
            });
            if (response.ok) {
              dispatchCrmEvent("crm:authenticated");
              return;
            }
            if (response.status >= 400 && response.status < 500) return;
          } catch {
            if (attempt < 2) await wait(500 * (attempt + 1));
          }
        }
      } finally {
        authInFlight = false;
      }
    };

    const handleRetry = () => {
      void authenticate();
    };
    window.addEventListener("crm:telegram-retry", handleRetry);
    void authenticate();

    return () => {
      cancelled = true;
      window.removeEventListener("crm:telegram-retry", handleRetry);
      if (activeWebApp && themeHandler) activeWebApp.offEvent?.("themeChanged", themeHandler);
    };
  }, []);

  return null;
}
