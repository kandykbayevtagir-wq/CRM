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
      // The CRM ships a single light palette (the header colour is forced light below as well);
      // taking Telegram's dark background here used to produce dark text on a dark page.
      root.style.setProperty("--tg-bg", "#f7f8fb");
      root.style.setProperty("--tg-surface", "#ffffff");
      root.style.setProperty("--tg-text", "#22212b");
      root.style.setProperty("--tg-hint", "#6f707c");
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
      for (const eventName of ["themeChanged", "safeAreaChanged", "contentSafeAreaChanged", "viewportChanged"]) webApp.onEvent?.(eventName, themeHandler);
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
              signal: AbortSignal.timeout(10_000),
              body: JSON.stringify({ initData }),
            });
            if (response.ok) {
              dispatchCrmEvent("crm:authenticated");
              return;
            }
            if (response.status >= 400 && response.status < 500) return;
          } catch { /* Retry transient network failures with the same signed init data. */ }
          if (attempt < 2 && !cancelled) await wait(500 * (attempt + 1));
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
      if (activeWebApp && themeHandler) for (const eventName of ["themeChanged", "safeAreaChanged", "contentSafeAreaChanged", "viewportChanged"]) activeWebApp.offEvent?.(eventName, themeHandler);
    };
  }, []);

  return null;
}
