import type { Metadata } from "next";
import Script from "next/script";

import { TelegramMiniApp } from "@/components/telegram-mini-app";
import "./globals.css";

export const metadata: Metadata = {
  title: "podologymk CRM",
  description: "Облачная CRM-система для podologymk",
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
