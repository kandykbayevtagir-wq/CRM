"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  CreditCard,
  FileBarChart,
  LayoutDashboard,
  Menu,
  Settings,
  ShieldCheck,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";

const primaryNavigation = [
  { href: "/", label: "Обзор", icon: LayoutDashboard },
  { href: "/appointments", label: "Записи", icon: CalendarDays, badge: "12" },
  { href: "/clients", label: "Клиенты", icon: UsersRound },
  { href: "/employees", label: "Сотрудники", icon: ClipboardList },
];

const financeNavigation = [
  { href: "/finance", label: "Финансы", icon: WalletCards },
  { href: "/reports", label: "Отчёты", icon: FileBarChart },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="app-shell">
      <button className="mobile-menu-button" onClick={() => setMobileOpen(true)} aria-label="Открыть меню">
        <Menu size={20} />
      </button>
      {mobileOpen ? <button className="mobile-overlay" onClick={() => setMobileOpen(false)} aria-label="Закрыть меню" /> : null}
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <Link href="/" className="brand-mark" onClick={() => setMobileOpen(false)}>
            <span className="brand-symbol">p</span>
            <span>
              <strong>podo</strong>
              <small>center CRM</small>
            </span>
          </Link>
          <button className="sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Закрыть меню">
            <X size={18} />
          </button>
        </div>

        <div className="branch-switcher">
          <span className="branch-avatar">С</span>
          <span className="branch-copy">
            <small>Текущий филиал</small>
            <strong>Сарыарка</strong>
          </span>
          <ChevronDown size={15} />
        </div>

        <nav className="sidebar-nav" aria-label="Основная навигация">
          <p className="nav-caption">РАБОЧИЙ СТОЛ</p>
          {primaryNavigation.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link key={item.href} href={item.href} className={`nav-item ${active ? "nav-item-active" : ""}`} onClick={() => setMobileOpen(false)}>
                <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
                <span>{item.label}</span>
                {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
              </Link>
            );
          })}

          <p className="nav-caption nav-caption-spaced">УПРАВЛЕНИЕ</p>
          {financeNavigation.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link key={item.href} href={item.href} className={`nav-item ${active ? "nav-item-active" : ""}`} onClick={() => setMobileOpen(false)}>
                <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <Link href="/settings" className={`nav-item ${pathname === "/settings" ? "nav-item-active" : ""}`} onClick={() => setMobileOpen(false)}>
            <Settings size={18} strokeWidth={1.8} />
            <span>Настройки</span>
          </Link>
          <div className="help-card">
            <div className="help-icon"><CircleHelp size={17} /></div>
            <div>
              <strong>Нужна помощь?</strong>
              <span>Открыть базу знаний</span>
            </div>
          </div>
          <div className="sidebar-user">
            <span className="user-avatar">ТК</span>
            <span className="user-copy">
              <strong>Тагир Кандыкаев</strong>
              <small>Владелец</small>
            </span>
            <ShieldCheck size={15} className="user-verified" />
          </div>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="topbar-breadcrumb"><span>podo center</span><span>/</span><strong>{pathname === "/" ? "Обзор" : pathname.slice(1)}</strong></div>
          <div className="topbar-actions">
            <button className="icon-button notification-button" aria-label="Уведомления">
              <Bell size={19} strokeWidth={1.8} />
              <span className="notification-dot" />
            </button>
            <button className="topbar-profile">
              <span className="topbar-avatar">ТК</span>
              <span className="topbar-profile-copy"><strong>Тагир</strong><small>Владелец</small></span>
              <ChevronDown size={15} />
            </button>
          </div>
        </header>
        <main className="content-area">{children}</main>
      </div>
    </div>
  );
}
