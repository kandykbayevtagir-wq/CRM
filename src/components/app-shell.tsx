"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
  RefreshCw,
  Settings,
  ShieldCheck,
  Star,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";

import { useApi } from "@/lib/use-api";
import { apiFetch } from "@/lib/api-client";
import type { AuthResponse, NotificationsResponse, SettingsResponse } from "@/lib/crm-types";
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

function formatShellDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const { data: auth } = useApi<AuthResponse>("/api/auth/me");
  const { data: settings } = useApi<SettingsResponse>("/api/settings");
  const user = auth?.user;
  const { data: notifications, loading: notificationsLoading, error: notificationsError, reload: reloadNotifications } = useApi<NotificationsResponse>("/api/notifications", undefined, { enabled: Boolean(user && user.role !== "CLIENT") });
  const [openPanel, setOpenPanel] = useState<"notifications" | "profile" | null>(null);
  const topbarActionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setSelectedBranchId(window.localStorage.getItem("pmk_branch_id") ?? "");
  }, []);
  useEffect(() => {
    function closeOnOutside(event: MouseEvent) {
      if (topbarActionsRef.current && !topbarActionsRef.current.contains(event.target as Node)) setOpenPanel(null);
    }
    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, []);
  const visiblePrimary = user ? primaryNavigation.filter((item) => hasPermission(user.role, item.permission)) : primaryNavigation;
  const visibleFinance = user ? financeNavigation.filter((item) => hasPermission(user.role, item.permission)) : financeNavigation;
  const initials = user?.name?.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "—";
  const role = user?.role === "OWNER" ? "Владелец" : user?.role === "ADMINISTRATOR" ? "Администратор" : user?.role === "SPECIALIST" ? "Специалист" : user?.role === "ACCOUNTANT" ? "Бухгалтер" : "Гость";
  const pageLabels: Record<string, string> = { "/": "Обзор", "/appointments": "Записи", "/clients": "Клиенты", "/employees": "Сотрудники", "/services": "Услуги", "/schedules": "Расписание", "/reviews": "Отзывы", "/finance": "Финансы", "/payroll": "Зарплата", "/reports": "Отчёты", "/settings": "Настройки" };
  const pageLabel = pageLabels[pathname] ?? pathname.slice(1);

  async function logout() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/";
    }
  }

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
          <div className="topbar-actions" ref={topbarActionsRef}>
            <button className={`icon-button notification-button ${openPanel === "notifications" ? "topbar-control-active" : ""}`} aria-label="Уведомления" aria-expanded={openPanel === "notifications"} onClick={() => { setOpenPanel(openPanel === "notifications" ? null : "notifications"); if (openPanel !== "notifications") void reloadNotifications(); }}>
              <Bell size={19} strokeWidth={1.8} />
              {notifications?.unreadCount ? <span className="notification-count">{notifications.unreadCount > 9 ? "9+" : notifications.unreadCount}</span> : null}
            </button>
            {openPanel === "notifications" ? <div className="topbar-popover notifications-popover">
              <div className="popover-heading"><div><span className="eyebrow">Центр событий</span><strong>Уведомления</strong></div><button className="popover-refresh" onClick={() => void reloadNotifications()} aria-label="Обновить уведомления"><RefreshCw size={15} /></button></div>
              {notificationsLoading ? <div className="popover-empty"><RefreshCw size={20} className="spin" /><strong>Загружаю события</strong><span>Проверяю записи, оплаты и изменения.</span></div> : notificationsError ? <div className="popover-empty"><Bell size={20} /><strong>Не удалось загрузить уведомления</strong><span>{notificationsError}</span><button className="button button-secondary" onClick={() => void reloadNotifications()}>Повторить</button></div> : !notifications?.items.length ? <div className="popover-empty"><Bell size={20} /><strong>Пока всё спокойно</strong><span>Новые записи, оплаты и изменения появятся здесь.</span></div> : <div className="notification-list">{notifications.items.map((item) => {
                const content = <><span className={`notification-item-icon notification-kind-${item.kind.toLowerCase()}`}><Bell size={14} /></span><span className="notification-item-copy"><strong>{item.title}</strong><span>{item.description}</span><small>{formatShellDate(item.occurredAt)}</small></span>{!item.read ? <i className="notification-unread" /> : null}</>;
                return item.href ? <Link href={item.href} key={item.id} className="notification-item" onClick={() => setOpenPanel(null)}>{content}</Link> : <div key={item.id} className="notification-item">{content}</div>;
              })}</div>}
            </div> : null}
            <button className={`topbar-profile ${openPanel === "profile" ? "topbar-control-active" : ""}`} aria-label="Открыть профиль" aria-expanded={openPanel === "profile"} onClick={() => setOpenPanel(openPanel === "profile" ? null : "profile")}>
              <span className="topbar-avatar">{initials}</span>
              <span className="topbar-profile-copy"><strong>{user?.name ?? "Гость"}</strong><small>{role}</small></span>
              <ChevronDown size={15} />
            </button>
            {openPanel === "profile" ? <div className="topbar-popover profile-popover">
              {user ? <>
                <div className="profile-popover-header"><span className="profile-popover-avatar">{initials}</span><div><strong>{user.name}</strong><span>{role}</span></div></div>
                <div className="profile-facts"><div><span>Telegram ID</span><strong>{user.telegramId}</strong></div><div><span>Username</span><strong>{user.telegramUsername || user.username ? `@${user.telegramUsername || user.username}` : "Не указан"}</strong></div><div><span>Телефон</span><strong>{user.phone || "Не указан"}</strong></div><div><span>Последний вход</span><strong>{formatShellDate(user.lastLoginAt)}</strong></div></div>
                <div className="profile-status"><span className="cloud-status-dot" /><span>Доступ активен · данные загружены по Telegram ID</span></div>
                <div className="profile-popover-actions">{hasPermission(user.role, "settings.read") ? <Link href="/settings" className="button button-secondary" onClick={() => setOpenPanel(null)}><Settings size={14} /> Настройки</Link> : null}<button className="button button-ghost" onClick={() => void logout()}>Выйти</button></div>
              </> : <>
                <div className="profile-popover-header"><span className="profile-popover-avatar">—</span><div><strong>Профиль Telegram</strong><span>Авторизация не завершена</span></div></div>
                <div className="profile-facts"><div><span>Источник данных</span><strong>Telegram Mini App</strong></div><div><span>Статус</span><strong>Ожидается вход</strong></div></div>
                <div className="profile-status profile-status-warning"><span className="cloud-status-dot" /><span>Откройте приложение внутри Telegram — профиль подтянется автоматически по Telegram ID.</span></div>
                <div className="profile-popover-actions"><button className="button button-secondary" onClick={() => window.location.reload()}><RefreshCw size={14} /> Повторить вход</button></div>
              </>}
            </div> : null}
          </div>
        </header>
        <main className="content-area page-transition">{children}</main>
      </div>
    </div>
  );
}
