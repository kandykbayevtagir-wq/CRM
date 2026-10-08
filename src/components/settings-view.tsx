"use client";

import { FormEvent, useEffect, useState } from "react";
import { Activity, BellRing, Building2, LockKeyhole, Plus, SlidersHorizontal, UserPlus, UsersRound } from "lucide-react";

import { apiFetch, dispatchCrmEvent } from "@/lib/api-client";
import { AuthHint, EmptyState, ErrorState, FormField, InlineError, isAuthError, LoadingState, Modal } from "@/components/data-state";
import { Button, PageHeader, SectionCard } from "@/components/ui";
import type { ClientRecord, SettingsResponse } from "@/lib/crm-types";
import { APP_VERSION } from "@/lib/release";
import { formatDateTime, plural } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useCan, useCurrentUser } from "@/lib/current-user";
import { PhoneInput } from "@/components/phone-input";

type UserRecord = { id: string; telegramId: string; username: string | null; name: string; role: string; active: number; clientId: string | null; lastLoginAt: string | null; createdAt: string };
type UsersResponse = { ok: true; items: UserRecord[] };
type ClientsResponse = { ok: true; items: ClientRecord[] };
type HealthResponse = { ok: boolean; version?: string; database?: string; latencyMs?: number; timestamp?: string };

const roleLabels: Record<string, string> = { OWNER: "Владелец", ADMINISTRATOR: "Администратор", SPECIALIST: "Специалист", ACCOUNTANT: "Бухгалтер", CLIENT: "Клиент" };
const weekdayNames = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function parseWorkingDays(value: string) {
  return new Set(value.split(",").map((day) => Number(day.trim())).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7));
}

export function SettingsView() {
  const currentUser = useCurrentUser();
  const canWrite = useCan("settings.write");
  const canManageUsers = useCan("users.read");
  const [brandName, setBrandName] = useState("");
  const [bookingStartTime, setBookingStartTime] = useState("09:00");
  const [bookingEndTime, setBookingEndTime] = useState("18:00");
  const [bookingSlotInterval, setBookingSlotInterval] = useState(30);
  const [workingDays, setWorkingDays] = useState<Set<number>>(() => new Set([1, 2, 3, 4, 5, 6]));
  const [cancellationWindowHours, setCancellationWindowHours] = useState(2);
  const [loyaltyPointsPer1000, setLoyaltyPointsPer1000] = useState(1);
  const [dailySummaryEnabled,setDailySummaryEnabled]=useState(false);
  const [dailySummaryHour,setDailySummaryHour]=useState(9);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [branchModalOpen, setBranchModalOpen] = useState(false);
  const [branchSaving, setBranchSaving] = useState(false);
  const [branchFormError, setBranchFormError] = useState<string | null>(null);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [inviteRole, setInviteRole] = useState("ADMINISTRATOR");
  const [userSaving, setUserSaving] = useState(false);
  const [userFormError, setUserFormError] = useState<string | null>(null);
  const [userPendingId, setUserPendingId] = useState<string | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { data, loading, error, reload } = useApi<SettingsResponse>("/api/settings");
  const { data: usersData, reload: reloadUsers, error: usersLoadError } = useApi<UsersResponse>("/api/users", undefined, { enabled: canManageUsers });
  const { data: clientsData } = useApi<ClientsResponse>("/api/clients?status=active&pageSize=100", undefined, { enabled: canManageUsers && userModalOpen && inviteRole === "CLIENT" });
  const { data: health, loading: healthLoading, reload: reloadHealth } = useApi<HealthResponse>("/api/health", undefined, { refreshInterval: 60_000 });

  useEffect(() => {
    if (!data?.settings) return;
    setBrandName(data.settings.brandName);
    setBookingStartTime(data.settings.bookingStartTime);
    setBookingEndTime(data.settings.bookingEndTime);
    setBookingSlotInterval(Number(data.settings.bookingSlotInterval));
    setWorkingDays(parseWorkingDays(data.settings.workingDays));
    setCancellationWindowHours(Number(data.settings.cancellationWindowHours));
    setLoyaltyPointsPer1000(Number(data.settings.loyaltyPointsPer1000));
    setDailySummaryEnabled(Boolean(data.settings.dailySummaryEnabled));setDailySummaryHour(data.settings.dailySummaryHour ?? 9);
  }, [data?.settings]);

  const dirty = Boolean(data?.settings) && (
    dailySummaryEnabled!==Boolean(data?.settings.dailySummaryEnabled) || dailySummaryHour!==(data?.settings.dailySummaryHour ?? 9) ||
    brandName !== data?.settings.brandName || bookingStartTime !== data?.settings.bookingStartTime || bookingEndTime !== data?.settings.bookingEndTime
    || bookingSlotInterval !== Number(data?.settings.bookingSlotInterval) || [...workingDays].sort().join(",") !== data?.settings.workingDays
    || cancellationWindowHours !== Number(data?.settings.cancellationWindowHours) || loyaltyPointsPer1000 !== Number(data?.settings.loyaltyPointsPer1000)
  );

  async function saveSettings() {
    if (saving) return;
    if (!brandName.trim()) { setFormError("Укажите название организации"); return; }
    if (bookingEndTime <= bookingStartTime) { setFormError("Конец рабочего дня должен быть позже начала"); return; }
    if (workingDays.size === 0) { setFormError("Выберите хотя бы один рабочий день"); return; }
    setSaving(true);
    setFormError(null);
    setSaved(false);
    try {
      await apiFetch("/api/settings", { method: "PATCH", body: { brandName: brandName.trim(), bookingStartTime, bookingEndTime, bookingSlotInterval, workingDays: [...workingDays].sort().join(","), cancellationWindowHours, loyaltyPointsPer1000,dailySummaryEnabled,dailySummaryHour } });
      dispatchCrmEvent("crm:data-changed");
      await reload();
      setSaved(true);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Не удалось сохранить настройки");
    } finally {
      setSaving(false);
    }
  }

  async function createBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (branchSaving) return;
    setBranchSaving(true);
    setBranchFormError(null);
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await apiFetch("/api/branches", { method: "POST", body: values });
      setBranchModalOpen(false);
      dispatchCrmEvent("crm:data-changed");
      await reload();
    } catch (cause) {
      setBranchFormError(cause instanceof Error ? cause.message : "Не удалось добавить филиал");
    } finally {
      setBranchSaving(false);
    }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (userSaving) return;
    setUserSaving(true);
    setUserFormError(null);
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget).entries());
      await apiFetch("/api/users", { method: "POST", body: values });
      setUserModalOpen(false);
      dispatchCrmEvent("crm:data-changed");
      await reloadUsers();
    } catch (cause) {
      setUserFormError(cause instanceof Error ? cause.message : "Не удалось пригласить пользователя");
    } finally {
      setUserSaving(false);
    }
  }

  async function updateUser(id: string, body: Record<string, unknown>) {
    if (userPendingId) return;
    setUserPendingId(id);
    setUsersError(null);
    try {
      await apiFetch(`/api/users/${id}`, { method: "PATCH", body });
      dispatchCrmEvent("crm:data-changed");
      await reloadUsers();
    } catch (cause) {
      setUsersError(cause instanceof Error ? cause.message : "Не удалось обновить пользователя");
    } finally {
      setUserPendingId(null);
    }
  }

  function toggleDay(day: number) {
    setWorkingDays((current) => { const next = new Set(current); if (next.has(day)) next.delete(day); else next.add(day); return next; });
  }

  const readOnlyHint = canWrite ? undefined : "Изменять настройки может только владелец центра.";

  return (
    <>
      <PageHeader eyebrow="Управление" title="Настройки" description={readOnlyHint ?? "Название центра, филиалы, роли и правила онлайн-записи."} actions={canWrite ? <Button onClick={() => void saveSettings()} loading={saving} disabled={!dirty && !saving}>{saving ? "Сохраняем…" : dirty ? "Сохранить изменения" : "Изменений нет"}</Button> : undefined} />

      {loading && !data ? <LoadingState /> : null}
      {error && isAuthError(error) ? <AuthHint /> : null}
      {error && !isAuthError(error) ? <ErrorState message={error} onRetry={reload} /> : null}
      {formError ? <InlineError>{formError}</InlineError> : null}
      {saved && !dirty ? <p className="notice notice-success" role="status">Настройки сохранены. Клиентский календарь использует новые правила сразу.</p> : null}

      {data ? <div className="settings-grid">
        <SectionCard title="Профиль центра" subtitle="Название показывается клиентам в Mini App и уведомлениях">
          <div className="settings-icon-heading"><span className="settings-big-icon settings-purple"><Building2 size={20} /></span><div><strong>{data.settings.brandName}</strong><span>Подологический центр · {plural(data.branches.length, ["филиал", "филиала", "филиалов"])}</span></div></div>
          <div className="settings-form"><FormField label="Название организации"><input value={brandName} maxLength={120} onChange={(event) => { setBrandName(event.target.value); setSaved(false); }} disabled={!canWrite} /></FormField></div>
          <div className="settings-list"><div className="settings-item"><div><strong>Валюта</strong><span>Используется в расчётах</span></div><span className="settings-value">{data.settings.currency} · Тенге</span></div><div className="settings-item"><div><strong>Часовой пояс</strong><span>Для календаря и уведомлений</span></div><span className="settings-value">{data.settings.timezone}</span></div></div>
        </SectionCard>

        <SectionCard title="Правила записи" subtitle="Эти параметры использует клиентский календарь">
          <div className="form-grid settings-rules-grid">
            <FormField label="Начало рабочего дня"><input type="time" value={bookingStartTime} step={900} onChange={(event) => { setBookingStartTime(event.target.value); setSaved(false); }} disabled={!canWrite} /></FormField>
            <FormField label="Конец рабочего дня"><input type="time" value={bookingEndTime} step={900} onChange={(event) => { setBookingEndTime(event.target.value); setSaved(false); }} disabled={!canWrite} /></FormField>
            <FormField label="Шаг календаря"><select value={bookingSlotInterval} onChange={(event) => { setBookingSlotInterval(Number(event.target.value)); setSaved(false); }} disabled={!canWrite}><option value={15}>15 минут</option><option value={30}>30 минут</option><option value={60}>60 минут</option></select></FormField>
            <FormField label="Отмена не позднее, чем за" hint="часов до начала приёма; 0 — без ограничения"><input type="number" min={0} max={72} inputMode="numeric" value={cancellationWindowHours} onChange={(event) => { setCancellationWindowHours(Math.max(0, Math.min(72, Number(event.target.value) || 0))); setSaved(false); }} disabled={!canWrite} /></FormField>
            <div className="form-field form-field-wide"><span>Рабочие дни</span><div className="weekday-picker" role="group" aria-label="Рабочие дни недели">{weekdayNames.map((name, index) => { const day = index + 1; const active = workingDays.has(day); return <button type="button" key={name} className={`segment-button ${active ? "segment-button-active" : ""}`} aria-pressed={active} onClick={() => { toggleDay(day); setSaved(false); }} disabled={!canWrite}>{name}</button>; })}</div></div>
            <FormField label="Сводка дня владельцу"><select value={dailySummaryEnabled?'on':'off'} disabled={!canWrite} onChange={e=>setDailySummaryEnabled(e.target.value==='on')}><option value="off">Выключена</option><option value="on">Отправлять в Telegram</option></select></FormField><FormField label="Час сводки" hint="По часовому поясу центра"><input type="number" min="0" max="23" value={dailySummaryHour} disabled={!canWrite} onChange={e=>setDailySummaryHour(Number(e.target.value))}/></FormField>
            <FormField label="Бонусов за каждые 1 000 ₸" className="form-field-wide" hint="Начисляются клиенту после завершения оплаченного приёма"><input type="number" min={0} max={100} inputMode="numeric" value={loyaltyPointsPer1000} onChange={(event) => { setLoyaltyPointsPer1000(Math.max(0, Math.min(100, Number(event.target.value) || 0))); setSaved(false); }} disabled={!canWrite} /></FormField>
          </div>
        </SectionCard>

        <SectionCard title="Филиалы" subtitle="Используются в записях, сотрудниках и расходах" action={canWrite ? <Button variant="secondary" onClick={() => { setBranchFormError(null); setBranchModalOpen(true); }}><Plus size={14} /> Добавить</Button> : undefined}>
          {data.branches.length === 0 ? <EmptyState title="Филиалов пока нет" description="Добавьте первый филиал, чтобы распределять записи и операции." action={canWrite ? <Button onClick={() => { setBranchFormError(null); setBranchModalOpen(true); }}><Plus size={15} /> Добавить филиал</Button> : undefined} /> : <div className="settings-list">{data.branches.map((branch) => <div className="settings-item" key={branch.id}><div><strong>{branch.name}</strong><span>{branch.address || "Адрес не указан"}{branch.phone ? ` · ${branch.phone}` : ""}</span></div><span className={`status-pill ${branch.isActive ? "status-active" : "status-inactive"}`}>{branch.isActive ? "Активен" : "Архив"}</span></div>)}</div>}
        </SectionCard>

        <SectionCard title="Состояние системы" subtitle="Проверка базы данных и версии приложения" action={<Button variant="ghost" onClick={() => void reloadHealth()} loading={healthLoading} aria-label="Проверить снова"><Activity size={14} /></Button>}>
          <div className={`cloud-status ${health && !health.ok ? "cloud-status-error" : ""}`}><span className="cloud-status-dot" aria-hidden="true" /><div><strong>{health ? (health.ok ? "База данных отвечает" : "База данных недоступна") : "Проверяем соединение…"}</strong><span>{health?.timestamp ? `Проверено ${formatDateTime(health.timestamp)}${typeof health.latencyMs === "number" ? ` · ${health.latencyMs} мс` : ""}` : "Результат появится через несколько секунд."}</span></div></div>
          <div className="settings-list cloud-details"><div className="settings-item"><div><strong>Версия приложения</strong><span>Mini App и API</span></div><span className="settings-value">{health?.version ?? APP_VERSION}</span></div><div className="settings-item"><div><strong>Журнал изменений</strong><span>Фиксирует операции сотрудников</span></div><span className="status-pill status-active">Включён</span></div></div>
        </SectionCard>

        <SectionCard title="Роли и доступы" subtitle="Базовые роли для сотрудников CRM"><div className="settings-list"><div className="settings-item"><div><strong>Владелец</strong><span>Полный доступ к центру и настройкам</span></div><UsersRound size={18} color="#6f5be7" /></div><div className="settings-item"><div><strong>Администратор</strong><span>Записи, клиенты, оплаты и склад</span></div><SlidersHorizontal size={18} color="#6f5be7" /></div><div className="settings-item"><div><strong>Специалист</strong><span>Только свои записи и клиенты</span></div><LockKeyhole size={18} color="#6f5be7" /></div><div className="settings-item"><div><strong>Бухгалтер</strong><span>Финансы, зарплата и отчёты</span></div><BellRing size={18} color="#6f5be7" /></div></div></SectionCard>

        {canManageUsers ? <SectionCard title="Пользователи CRM" subtitle="Доступ выдаётся только приглашённым Telegram ID" action={<Button variant="secondary" onClick={() => { setUserFormError(null); setInviteRole("ADMINISTRATOR"); setUserModalOpen(true); }}><UserPlus size={14} /> Пригласить</Button>}>
          {usersLoadError && !usersData ? <ErrorState message={usersLoadError} onRetry={reloadUsers} /> : null}
          {usersData ? <div className="settings-list">{usersData.items.map((item) => {
            const isSelf = item.id === currentUser?.id;
            const busy = userPendingId === item.id;
            return <div className="settings-item user-settings-row" key={item.id} aria-busy={busy || undefined}>
              <div><strong>{item.name}{isSelf ? " (вы)" : ""}</strong><span>Telegram ID: {item.telegramId}{item.username ? ` · @${item.username}` : ""}{item.lastLoginAt ? ` · вход ${formatDateTime(item.lastLoginAt)}` : " · ещё не входил"}</span></div>
              <div className="user-settings-actions">
                <select value={item.role} onChange={(event) => void updateUser(item.id, { role: event.target.value })} aria-label={`Роль: ${item.name}`} disabled={Boolean(userPendingId) || isSelf}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                <button type="button" className={`status-pill ${item.active ? "status-active" : "status-inactive"}`} onClick={() => void updateUser(item.id, { active: !item.active })} disabled={Boolean(userPendingId) || isSelf} aria-label={`${item.active ? "Отключить" : "Включить"} доступ: ${item.name}`}>{busy ? "Сохраняем…" : item.active ? "Активен" : "Отключён"}</button>
              </div>
            </div>;
          })}</div> : null}
          {usersError ? <InlineError>{usersError}</InlineError> : null}
        </SectionCard> : null}
      </div> : null}

      {branchModalOpen ? <Modal title="Добавить филиал" onClose={() => setBranchModalOpen(false)} busy={branchSaving} footer={<><Button variant="secondary" onClick={() => setBranchModalOpen(false)} disabled={branchSaving}>Отмена</Button><Button type="submit" form="branch-form" loading={branchSaving}>{branchSaving ? "Сохраняем…" : "Сохранить филиал"}</Button></>}>
        <form id="branch-form" className="form-grid" onSubmit={createBranch}><FormField label="Название"><input name="name" required maxLength={120} placeholder="Например, Центральный филиал" autoFocus /></FormField><FormField label="Телефон"><PhoneInput placeholder="+7 700 123 45 67" /></FormField><FormField label="Адрес" className="form-field-wide"><input name="address" required maxLength={300} placeholder="Адрес филиала" /></FormField>{branchFormError ? <div className="form-field-wide"><InlineError>{branchFormError}</InlineError></div> : null}</form>
      </Modal> : null}

      {userModalOpen ? <Modal title="Пригласить пользователя" onClose={() => setUserModalOpen(false)} busy={userSaving} footer={<><Button variant="secondary" onClick={() => setUserModalOpen(false)} disabled={userSaving}>Отмена</Button><Button type="submit" form="user-form" loading={userSaving}>{userSaving ? "Сохраняем…" : "Создать доступ"}</Button></>}>
        <form id="user-form" className="form-grid" onSubmit={createUser}>
          <FormField label="Telegram ID" hint="Числовой ID из Telegram, не @username. Его можно узнать у бота @userinfobot."><input name="telegramId" required inputMode="numeric" pattern="\d{1,20}" title="Только цифры" placeholder="Например, 123456789" autoFocus /></FormField>
          <FormField label="Имя"><input name="name" required maxLength={120} placeholder="Имя сотрудника" /></FormField>
          <FormField label="Username"><input name="username" maxLength={64} placeholder="без @" /></FormField>
          <FormField label="Роль"><select name="role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>{["ADMINISTRATOR", "SPECIALIST", "ACCOUNTANT", "OWNER", "CLIENT"].map((value) => <option key={value} value={value}>{roleLabels[value]}</option>)}</select></FormField>
          {inviteRole === "CLIENT" ? <FormField label="Карточка клиента" className="form-field-wide" hint="Клиент увидит только свой личный кабинет и свои записи."><select name="clientId" required defaultValue=""><option value="" disabled>{clientsData ? "Выберите карточку клиента" : "Загружаем клиентов…"}</option>{clientsData?.items.filter((client) => client.isActive !== 0).map((client) => <option key={client.id} value={client.id}>{client.fullName} · {client.phone}</option>)}</select></FormField> : null}
          {userFormError ? <div className="form-field-wide"><InlineError>{userFormError}</InlineError></div> : null}
        </form>
      </Modal> : null}
    </>
  );
}
