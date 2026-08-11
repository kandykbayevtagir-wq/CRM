"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { CalendarDays, Gift, Home, UserRound } from "lucide-react";

import type { AuthUser } from "@/lib/crm-types";

export function ClientShell({ children, user }: { children: ReactNode; user?: AuthUser }) {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    const backButton = window.Telegram?.WebApp.BackButton;
    if (!backButton) return;
    const isNested = pathname !== "/";
    const handleBack = () => router.back();
    if (isNested) {
      backButton.onClick(handleBack);
      backButton.show();
    } else backButton.hide();
    return () => {
      backButton.offClick(handleBack);
      backButton.hide();
    };
  }, [pathname, router]);

  const navClass = (href: string) => `client-nav-item ${pathname === href ? "client-nav-item-active" : ""}`;
  return (
    <div className="client-app-shell">
      <header className="client-topbar">
        <Link href="/" className="client-brand"><span className="brand-symbol">p</span><span><strong>podologymk</strong><small>Ваш личный кабинет</small></span></Link>
        <span className="client-avatar">{user?.name?.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "P"}</span>
      </header>
      <main className="client-content page-transition">{children}</main>
      <nav className="client-bottom-nav" aria-label="Навигация клиента">
        <Link href="/" className={navClass("/")} aria-current={pathname === "/" ? "page" : undefined}><Home size={19} /><span>Главная</span></Link>
        <Link href="/client/book" className={`${navClass("/client/book")} client-nav-primary`} aria-current={pathname === "/client/book" ? "page" : undefined}><CalendarDays size={20} /><span>Записаться</span></Link>
        <Link href="/client/loyalty" className={navClass("/client/loyalty")} aria-current={pathname === "/client/loyalty" ? "page" : undefined}><Gift size={19} /><span>Бонусы</span></Link>
        <Link href="/client/profile" className={navClass("/client/profile")} aria-current={pathname === "/client/profile" ? "page" : undefined}><UserRound size={19} /><span>Профиль</span></Link>
      </nav>
    </div>
  );
}
