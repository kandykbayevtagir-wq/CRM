import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "podo center CRM",
  description: "CRM для подологического центра",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
