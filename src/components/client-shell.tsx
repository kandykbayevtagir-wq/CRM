"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarDays, Gift, Home, UserRound } from "lucide-react";

import type { AuthUser } from "@/lib/crm-types";

export function ClientShell({ children, user }: { children: ReactNode; user?: AuthUser }) {
  return (
    <div className="client-app-shell">
      <header className="client-topbar">
        <Link href="/" className="client-brand"><span className="brand-symbol">p</span><span><strong>podologymk</strong><small>Ваш личный кабинет</small></span></Link>
        <span className="client-avatar">{user?.name?.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "P"}</span>
      </header>
      <main className="client-content page-transition">{children}</main>
      <nav className="client-bottom-nav" aria-label="Навигация клиента">
        <Link href="/" className="client-nav-item"><Home size={19} /><span>Главная</span></Link>
        <Link href="/client/book" className="client-nav-item client-nav-primary"><CalendarDays size={20} /><span>Записаться</span></Link>
        <Link href="/client/loyalty" className="client-nav-item"><Gift size={19} /><span>Бонусы</span></Link>
        <Link href="/client/profile" className="client-nav-item"><UserRound size={19} /><span>Профиль</span></Link>
      </nav>
    </div>
  );
}
