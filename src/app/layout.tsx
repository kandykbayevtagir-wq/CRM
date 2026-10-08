import type { Metadata } from "next";
import Script from "next/script";

import { TelegramMiniApp } from "@/components/telegram-mini-app";
import { NetworkStatus } from "@/components/network-status";
import "./globals.css";
import "./workspace.css";

export const metadata: Metadata = {
  title: "podologymk CRM",
  description: "Облачная CRM-система для podologymk",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body><a className="skip-link" href="#main-content">К содержимому</a><NetworkStatus />{children}<TelegramMiniApp /></body>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
    </html>
  );
}
