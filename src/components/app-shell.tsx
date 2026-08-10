"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bell,
  Banknote,
  BriefcaseBusiness,
  CalendarDays,
  CalendarClock,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  FileBarChart,
  LayoutDashboard,
  Menu,
  Settings,
  ShieldCheck,
  Star,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";

import { useApi } from "@/lib/use-api";
import type { AuthResponse, SettingsResponse } from "@/lib/crm-types";
import { ClientShell } from "@/components/client-shell";
import { hasPermission, type Permission } from "@/lib/permissions";

const primaryNavigation = [
  { href: "/", label: "Обзор", icon: LayoutDashboard, permission: "dashboard.read" as Permission },
  { href: "/appointments", label: "Записи", icon: CalendarDays, permission: "appointments.read" as Permission },
  { href: "/clients", label: "Клиенты", icon: UsersRound, permission: "clients.read" as Permission },
  { href: "/employees", label: "Сотрудники", icon: ClipboardList, permission: "employees.read" as Permission },
];

const financeNavigation = [
  { href: "/services", label: "Услуги", icon: BriefcaseBusiness, permission: "services.read" as Permission },
  { href: "/schedules", label: "Расписание", icon: CalendarClock, permission: "schedules.read" as Permission },
  { href: "/reviews", label: "Отзывы", icon: Star, permission: "reviews.read" as Permission },
  { href: "/finance", label: "Финансы", icon: WalletCards, permission: "finance.read" as Permission },
  { href: "/payroll", label: "Зарплата", icon: Banknote, permission: "payroll.read" as Permission },
  { href: "/reports", label: "Отчёты", icon: FileBarChart, permission: "reports.read" as Permission },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const { data: auth } = useApi<AuthResponse>("/api/auth/me");
  const { data: settings } = useApi<SettingsResponse>("/api/settings");
  const user = auth?.user;
  useEffect(() => {
    setSelectedBranchId(window.localStorage.getItem("pmk_branch_id") ?? "");
  }, []);
  const visiblePrimary = user ? primaryNavigation.filter((item) => hasPermission(user.role, item.permission)) : primaryNavigation;
  const visibleFinance = user ? financeNavigation.filter((item) => hasPermission(user.role, item.permission)) : financeNavigation;
  const initials = user?.name?.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "—";
  const role = user?.role === "OWNER" ? "Владелец" : user?.role === "ADMINISTRATOR" ? "Администратор" : user?.role === "SPECIALIST" ? "Специалист" : user?.role === "ACCOUNTANT" ? "Бухгалтер" : "Гость";
  const pageLabels: Record<string, string> = { "/": "Обзор", "/appointments": "Записи", "/clients": "Клиенты", "/employees": "Сотрудники", "/services": "Услуги", "/schedules": "Расписание", "/reviews": "Отзывы", "/finance": "Финансы", "/payroll": "Зарплата", "/reports": "Отчёты", "/settings": "Настройки" };
  const pageLabel = pageLabels[pathname] ?? pathname.slice(1);

  if (user?.role === "CLIENT") return <ClientShell user={user}>{children}</ClientShell>;

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
              <strong>podologymk</strong>
              <small>CRM для центра</small>
            </span>
          </Link>
          <button className="sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Закрыть меню">
            <X size={18} />
          </button>
        </div>

        <label className="branch-switcher">
          <span className="branch-avatar">P</span>
          <span className="branch-copy">
            <small>Рабочее пространство</small>
            <select value={selectedBranchId} onChange={(event) => { setSelectedBranchId(event.target.value); window.localStorage.setItem("pmk_branch_id", event.target.value); window.dispatchEvent(new Event("crm:data-changed")); }} aria-label="Текущий филиал"><option value="">Все филиалы{settings?.branches?.length ? ` · ${settings.branches.length}` : ""}</option>{settings?.branches?.filter((branch) => branch.isActive).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select>
          </span>
          <ChevronDown size={15} />
        </label>

        <nav className="sidebar-nav" aria-label="Основная навигация">
          <p className="nav-caption">РАБОЧИЙ СТОЛ</p>
          {visiblePrimary.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link key={item.href} href={item.href} className={`nav-item ${active ? "nav-item-active" : ""}`} onClick={() => setMobileOpen(false)}>
                <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
                <span>{item.label}</span>
              </Link>
            );
          })}

          <p className="nav-caption nav-caption-spaced">УПРАВЛЕНИЕ</p>
          {visibleFinance.map((item) => {
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
          {(!user || hasPermission(user.role, "settings.read")) ? <Link href="/settings" className={`nav-item ${pathname === "/settings" ? "nav-item-active" : ""}`} onClick={() => setMobileOpen(false)}><Settings size={18} strokeWidth={1.8} /><span>Настройки</span></Link> : null}
          <div className="help-card">
            <div className="help-icon"><CircleHelp size={17} /></div>
            <div>
              <strong>Нужна помощь?</strong>
              <span>Открыть базу знаний</span>
            </div>
          </div>
          <div className="sidebar-user">
            <span className="user-avatar">{initials}</span>
            <span className="user-copy">
              <strong>{user?.name ?? "Гость"}</strong>
              <small>{role}</small>
            </span>
            <ShieldCheck size={15} className="user-verified" />
          </div>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="topbar-breadcrumb"><span>podologymk</span><span>/</span><strong>{pageLabel}</strong></div>
          <div className="topbar-actions">
            <button className="icon-button notification-button" aria-label="Уведомления">
              <Bell size={19} strokeWidth={1.8} />
              <span className="notification-dot" />
            </button>
            <button className="topbar-profile">
              <span className="topbar-avatar">{initials}</span>
              <span className="topbar-profile-copy"><strong>{user?.name ?? "Гость"}</strong><small>{role}</small></span>
              <ChevronDown size={15} />
            </button>
          </div>
        </header>
        <main className="content-area page-transition">{children}</main>
      </div>
    </div>
  );
}
