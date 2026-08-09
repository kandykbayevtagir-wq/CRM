import type { Metadata } from "next";
import Script from "next/script";

import { TelegramMiniApp } from "@/components/telegram-mini-app";
import "./globals.css";

export const metadata: Metadata = {
  title: "podo center CRM",
  description: "CRM для подологического центра",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      <TelegramMiniApp />
    </html>
  );
}
