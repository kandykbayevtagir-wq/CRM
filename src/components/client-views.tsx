"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, Check, ChevronLeft, Clock3, Gift, MapPin, MessageCircle, RefreshCw, ShieldCheck, Star, UserRound } from "lucide-react";

import { ApiError, apiFetch, dispatchCrmEvent } from "@/lib/api-client";
import { AuthHint, EmptyState, ErrorState, FormField, InlineError, isAuthError, LoadingState } from "@/components/data-state";
import { Amount, Button, SectionCard, StatusPill } from "@/components/ui";
import type { AvailabilityResponse, AvailabilitySlot, Branch, ClientAppointment, LoyaltyResponse, ServiceRecord } from "@/lib/crm-types";
import { formatCurrency, formatDateTime, initials } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { PhoneInput } from "@/components/phone-input";

type ClientProfile = { id: string; fullName: string; phone: string; email: string | null; notes?: string | null; pointsBalance?: number };
type ProfileResponse = { ok: true; user: { name: string; phone: string | null; notificationsAllowed: number }; profile: ClientProfile | null; consents: Array<{ kind: string; version: string }> };
type CatalogResponse = { ok: true; user: { name: string }; profile: ClientProfile | null; services: ServiceRecord[]; branches: Branch[] };
type AppointmentResponse = { ok: true; items: ClientAppointment[] };
type ReviewItem = { appointmentId: string; startsAt: string; amount: number; serviceName: string | null; reviewId: string | null; rating: number | null; reviewText: string | null; status: string | null };
type ReviewsResponse = { ok: true; items: ReviewItem[] };

function todayValue() {
  return dateInTimezone(new Date(), "Asia/Almaty");
}

function dateInTimezone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${value}T12:00:00`));
}

function dateInAlmaty(value: string) {
  return dateInTimezone(new Date(value), "Asia/Almaty");
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function statusKey(status: string) {
  return status.toLowerCase();
}

function bookAgainHref(item: ClientAppointment) {
  const params = new URLSearchParams();
  if (item.serviceId) params.set("serviceId", item.serviceId);
  if (item.branchId) params.set("branchId", item.branchId);
  if (item.employeeId) params.set("employeeId", item.employeeId);
  const query = params.toString();
  return query ? `/client/book?${query}` : "/client/book";
}

function focusFirstInvalid() {
  window.requestAnimationFrame(() => {
    const field = document.querySelector<HTMLElement>("[aria-invalid=\"true\"]");
    field?.focus();
    field?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

function openSupport() {
  const url = `https://t.me/share/url?url=${encodeURIComponent(window.location.href)}&text=${encodeURIComponent("Здравствуйте! Нужна помощь с записью в podologymk.")}`;
  window.Telegram?.WebApp.openTelegramLink?.(url);
  if (!window.Telegram?.WebApp.openTelegramLink) window.open(url, "_blank", "noopener,noreferrer");
}

export function ClientOnboarding({ onComplete, prefillName = "" }: { onComplete?: () => void; prefillName?: string }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});
    const formData = new FormData(event.currentTarget);
    const body: Record<string, unknown> = Object.fromEntries(formData.entries());
    body.allowReminders = formData.get("allowReminders") === "on";
    try {
      await apiFetch("/api/client/profile", { method: "POST", body });
      dispatchCrmEvent("crm:data-changed");
      onComplete?.();
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
        setFieldErrors(cause.fieldErrors);
        if (Object.keys(cause.fieldErrors).length) focusFirstInvalid();
      } else setError(cause instanceof Error ? cause.message : "Не удалось сохранить профиль");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="client-onboarding">
      <div className="client-welcome-icon"><UserRound size={25} /></div>
      <p className="client-eyebrow">Первый запуск</p>
      <h1>Создадим ваш личный кабинет</h1>
      <p className="client-lead">Заполните данные один раз — дальше запись в podologymk займёт меньше минуты.</p>
      <form className="client-form" onSubmit={submit}>
        <FormField label="Имя и фамилия" error={fieldErrors.fullName} errorId="onboarding-full-name-error"><input name="fullName" required placeholder="Как к вам обращаться" autoFocus autoComplete="name" defaultValue={prefillName} aria-invalid={Boolean(fieldErrors.fullName)} aria-describedby={fieldErrors.fullName ? "onboarding-full-name-error" : undefined} /></FormField>
        <FormField label="Телефон" error={fieldErrors.phone} errorId="onboarding-phone-error"><PhoneInput required placeholder="+7 700 123 45 67" enterKeyHint="next" aria-invalid={Boolean(fieldErrors.phone)} aria-describedby={fieldErrors.phone ? "onboarding-phone-error" : undefined} /></FormField>
        <FormField label="Email, если удобно"><input name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="Для чека и связи" /></FormField>
        <label className="consent-row"><input name="allowReminders" type="checkbox" defaultChecked /><span><strong>Напоминать о визитах в Telegram</strong><small>Без рекламных сообщений без отдельного согласия</small></span></label>
        {error && Object.keys(fieldErrors).length === 0 ? <InlineError>{error}</InlineError> : null}
        <button className="button button-primary client-wide-button" type="submit" disabled={saving}>{saving ? "Сохраняем…" : "Продолжить"}<ArrowRight size={16} /></button>
      </form>
      <p className="client-privacy"><ShieldCheck size={14} /> Данные доступны только вам и сотрудникам podologymk с нужным уровнем доступа.</p>
    </section>
  );
}

export function ClientHomeView() {
  const { data, loading, error, reload } = useApi<ProfileResponse>("/api/client/profile");
  const { data: appointments } = useApi<AppointmentResponse>("/api/client/appointments");
  const { data: loyalty } = useApi<LoyaltyResponse>("/api/client/loyalty");
  const nextAppointment = useMemo(() => (appointments?.items ?? []).filter((item) => !["cancelled", "completed", "no_show"].includes(statusKey(item.status)) && new Date(item.startsAt).getTime() > Date.now()).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0], [appointments]);

  if (loading && !data) return <LoadingState label="Загружаем ваш кабинет…" />;
  if (error && isAuthError(error)) return <AuthHint />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (data && !data.profile) return <ClientOnboarding prefillName={data.user.name.startsWith("Пользователь podologymk") ? "" : data.user.name} onComplete={() => void reload()} />;
  if (!data?.profile) return null;

  return (
    <>
      <div className="client-greeting"><p className="client-eyebrow">Личный кабинет</p><h1>Здравствуйте, {data.profile.fullName.split(" ")[0]} 👋</h1><p>Здесь всё для вашего следующего визита.</p></div>
      <Link href="/client/book" className="client-primary-card"><span className="client-primary-icon"><CalendarDays size={22} /></span><span><strong>Записаться на приём</strong><small>Выберите услугу и удобное время</small></span><ArrowRight size={19} /></Link>

      {nextAppointment ? <section className="next-appointment-card"><div className="next-card-heading"><span>Ближайший визит</span><StatusPill status={statusKey(nextAppointment.status)} /></div><strong className="next-card-service">{nextAppointment.serviceName ?? "Приём в podologymk"}</strong><div className="next-card-details"><span><CalendarDays size={15} /> {formatDateTime(nextAppointment.startsAt)}</span><span><Clock3 size={15} /> {nextAppointment.employeeName ?? "Специалист"}</span><span><MapPin size={15} /> {nextAppointment.branchName ?? "Филиал уточняется"}</span></div><div className="next-card-actions"><Link href="/client/appointments" className="button button-secondary">Подробнее</Link><Link href={`/client/book?reschedule=${nextAppointment.id}`} className="button button-ghost">Перенести</Link></div></section> : <EmptyState title="Ближайших визитов пока нет" description="Выберите услугу — система покажет только реальные свободные окна." action={<Link href="/client/book" className="button button-primary">Записаться</Link>} />}

      <div className="client-stat-grid"><Link href="/client/loyalty" className="client-stat-card"><span className="client-stat-icon client-stat-gift"><Gift size={18} /></span><span><small>Ваши бонусы</small><strong>{loyalty?.account.pointsBalance ?? 0} баллов</strong></span></Link><Link href="/client/appointments" className="client-stat-card"><span className="client-stat-icon client-stat-calendar"><CalendarDays size={18} /></span><span><small>Всего визитов</small><strong>{appointments?.items.filter((item) => statusKey(item.status) === "completed").length ?? 0}</strong></span></Link></div>

      <button type="button" className="client-help-card" onClick={openSupport}><MessageCircle size={19} /><div><strong>Нужна помощь?</strong><span>Напишите администратору через Telegram</span></div><ArrowRight size={16} /></button>
    </>
  );
}

export function ClientBookingView() {
  const searchParams = useSearchParams();
  const rescheduleId = searchParams.get("reschedule") ?? "";
  const initialServiceId = searchParams.get("serviceId") ?? "";
  const initialBranchId = searchParams.get("branchId") ?? "";
  const initialEmployeeId = searchParams.get("employeeId") ?? "";
  const { data: catalog, loading, error, reload } = useApi<CatalogResponse>("/api/client/catalog");
  const { data: appointmentData } = useApi<AppointmentResponse>("/api/client/appointments");
  const [branchId, setBranchId] = useState(initialBranchId);
  const [serviceId, setServiceId] = useState(initialServiceId);
  const [employeeId, setEmployeeId] = useState(initialEmployeeId);
  const [date, setDate] = useState(todayValue);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
  const [pendingSlotStart, setPendingSlotStart] = useState<string | null>(null);
  const [employeeOptions, setEmployeeOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ id: string; changed: boolean; previousStartsAt: string | null; slot: AvailabilitySlot; service: ServiceRecord; branch: Branch } | null>(null);
  const slotsPath = branchId && serviceId && date ? `/api/client/availability?date=${date}&branchId=${branchId}&serviceId=${serviceId}&includeNext=1${employeeId ? `&employeeId=${employeeId}` : ""}` : "";
  const { data: slots, loading: slotsLoading, error: slotsError, reload: reloadSlots } = useApi<AvailabilityResponse>(slotsPath, undefined, { enabled: Boolean(slotsPath) });
  const currentService = catalog?.services.find((service) => service.id === serviceId);
  const currentBranch = catalog?.branches.find((branch) => branch.id === branchId);
  const derivedSlotEmployees = useMemo(() => {
    const unique = new Map<string, string>();
    for (const slot of slots?.items ?? []) unique.set(slot.employeeId, slot.employeeName);
    return [...unique.entries()].map(([id, name]) => ({ id, name }));
  }, [slots]);
  const slotEmployees = employeeOptions.length ? employeeOptions : derivedSlotEmployees;
  const quickDates = useMemo(() => Array.from({ length: 5 }, (_, offset) => addDays(todayValue(), offset)), []);

  useEffect(() => { setSelectedSlot(null); setEmployeeOptions([]); }, [branchId, serviceId, date]);
  useEffect(() => { setSelectedSlot(null); }, [employeeId]);
  useEffect(() => {
    if (!slots?.items.length) return;
    setEmployeeOptions((current) => {
      const next = new Map(current.map((employee) => [employee.id, employee.name]));
      for (const slot of slots.items) next.set(slot.employeeId, slot.employeeName);
      return [...next.entries()].map(([id, name]) => ({ id, name }));
    });
  }, [slots]);

  useEffect(() => {
    if (!pendingSlotStart || !slots?.items.length) return;
    const pendingSlot = slots.items.find((slot) => slot.startsAt === pendingSlotStart && (!employeeId || slot.employeeId === employeeId));
    if (!pendingSlot) return;
    setSelectedSlot(pendingSlot);
    setPendingSlotStart(null);
  }, [employeeId, pendingSlotStart, slots]);

  useEffect(() => {
    if (!rescheduleId || serviceId) return;
    const appointment = appointmentData?.items.find((item) => item.id === rescheduleId);
    if (!appointment) return;
    setServiceId(appointment.serviceId ?? "");
    setBranchId(appointment.branchId ?? "");
    setEmployeeId(appointment.employeeId ?? "");
    setDate(dateInAlmaty(appointment.startsAt));
  }, [appointmentData, rescheduleId, serviceId]);

  async function book() {
    if (!selectedSlot || !currentService || !currentBranch || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const response = await apiFetch<{ ok: true; id: string; changed: boolean }>("/api/client/appointments", { method: "POST", body: { startsAt: selectedSlot.startsAt, serviceId, branchId, employeeId: selectedSlot.employeeId, ...(rescheduleId ? { appointmentId: rescheduleId } : {}) } });
      window.Telegram?.WebApp.hideKeyboard?.();
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred?.("success");
      dispatchCrmEvent("crm:data-changed");
      setSuccess({ id: response.id, changed: response.changed, previousStartsAt: appointmentData?.items.find((item) => item.id === rescheduleId)?.startsAt ?? null, slot: selectedSlot, service: currentService, branch: currentBranch });
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "SLOT_UNAVAILABLE") {
        setSelectedSlot(null);
        setNotice(cause.message);
        await reloadSlots();
        window.Telegram?.WebApp.HapticFeedback?.notificationOccurred?.("error");
      } else setNotice(cause instanceof Error ? cause.message : "Не удалось создать запись");
    } finally {
      setSaving(false);
    }
  }

  async function joinWaitlist() {
    try {
      await apiFetch("/api/client/waitlist", { method: "POST", body: { serviceId, branchId, preferredDate: date } });
      setNotice(`Вы в листе ожидания на ${dateLabel(date)}. Если появится подходящее окно, мы сообщим в Telegram.`);
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred?.("success");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Не удалось добавить в лист ожидания");
    }
  }

  if (loading && !catalog) return <LoadingState label="Загружаем услуги и филиалы…" />;
  if (error && isAuthError(error)) return <AuthHint />;
  if (error && !catalog) return <ErrorState message={error} onRetry={reload} />;
  if (catalog && !catalog.profile) return <ClientOnboarding prefillName={catalog.user.name.startsWith("Пользователь podologymk") ? "" : catalog.user.name} onComplete={() => void reload()} />;
  if (!catalog) return null;
  if (success) return <section className="booking-success-card"><span className="booking-success-icon"><Check size={24} /></span><p className="client-eyebrow">Готово</p><h1>{success.changed ? "Запись перенесена" : "Запись подтверждена"}</h1>{success.previousStartsAt ? <p className="booking-success-previous">Было: {formatDateTime(success.previousStartsAt)}</p> : null}<p>{formatDateTime(success.slot.startsAt)} · {success.service.name}</p><span>{success.slot.employeeName} · {success.branch.name}</span><div className="booking-success-actions"><Link href={`/client/appointments#appointment-${success.id}`} className="button button-primary">Открыть запись</Link><Link href="/" className="button button-secondary">В кабинет</Link></div></section>;

  return (
    <>
      <Link href="/" className="client-back-link"><ChevronLeft size={17} /> В кабинет</Link>
      <div className="client-greeting compact"><p className="client-eyebrow">{rescheduleId ? "Перенос записи" : "Новая запись"}</p><h1>{rescheduleId ? "Выберите новое время" : "Когда вам удобно?"}</h1><p>{rescheduleId ? "Старая запись останется, пока новое время не подтвердится." : "Покажем только реальные доступные окна."}</p></div>
      {catalog.services.length === 0 || catalog.branches.length === 0 ? <EmptyState title="Запись пока не настроена" description="Администратору нужно добавить филиал и услуги в каталоге podologymk." /> : <>
        <section className="client-step-card"><div className="client-step-title"><span>1</span><div><strong>Выберите услугу</strong><small>Продолжительность и цена указаны сразу</small></div></div><div className="choice-grid">{catalog.services.map((service) => <button key={service.id} className={`choice-card ${service.id === serviceId ? "choice-card-selected" : ""}`} onClick={() => setServiceId(service.id)}><span><strong>{service.name}</strong><small>{service.category} · {service.durationMinutes} мин</small></span><b>{formatCurrency(Number(service.price || 0))}</b></button>)}</div></section>
        <section className="client-step-card"><div className="client-step-title"><span>2</span><div><strong>Выберите филиал</strong><small>Где вам будет удобнее</small></div></div><div className="choice-grid">{catalog.branches.map((branch) => <button key={branch.id} className={`choice-card ${branch.id === branchId ? "choice-card-selected" : ""}`} onClick={() => setBranchId(branch.id)}><span><strong>{branch.name}</strong><small>{branch.address || "Адрес уточняется"}</small></span><MapPin size={17} /></button>)}</div></section>
        <section className="client-step-card"><div className="client-step-title"><span>3</span><div><strong>Выберите день</strong><small>{dateLabel(date)}</small></div></div><div className="quick-date-list">{quickDates.map((quickDate, index) => <button type="button" key={quickDate} className={`quick-date ${date === quickDate ? "quick-date-selected" : ""}`} onClick={() => { setDate(quickDate); window.Telegram?.WebApp.HapticFeedback?.selectionChanged?.(); }}><strong>{index === 0 ? "Сегодня" : new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(new Date(`${quickDate}T12:00:00`))}</strong><small>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(`${quickDate}T12:00:00`))}</small></button>)}</div><input className="client-date-input" type="date" value={date} min={todayValue()} onChange={(event) => setDate(event.target.value)} /></section>
        {branchId && serviceId ? <section className="client-step-card"><div className="client-step-title"><span>4</span><div><strong>Свободные окна</strong><small>{currentService ? `${currentService.name} · ${formatCurrency(Number(currentService.price || 0))}` : "Выберите услугу"}</small></div></div>{slotEmployees.length ? <label className="specialist-select"><span>Специалист</span><select value={employeeId} onChange={(event) => { setEmployeeId(event.target.value); window.Telegram?.WebApp.HapticFeedback?.selectionChanged?.(); }}><option value="">Любой специалист — ближайшее время</option>{slotEmployees.map((employee) => <option value={employee.id} key={employee.id}>{employee.name}</option>)}</select></label> : null}{slotsLoading ? <LoadingState label="Проверяем расписание…" /> : slotsError ? <ErrorState message={slotsError} onRetry={() => void reloadSlots()} /> : slots?.items.length ? <div className="slot-grid">{slots.items.map((slot) => <button type="button" key={`${slot.employeeId}-${slot.startsAt}`} className={`slot-button ${selectedSlot?.startsAt === slot.startsAt && selectedSlot.employeeId === slot.employeeId ? "slot-button-selected" : ""}`} onClick={() => { setSelectedSlot(slot); window.Telegram?.WebApp.HapticFeedback?.selectionChanged?.(); }}><strong>{formatDateTime(slot.startsAt).split(", ").pop()}</strong><small>{slot.employeeName}</small></button>)}</div> : slots?.next ? <div className="next-slot-card"><strong>Ближайшее окно</strong><span>{formatDateTime(slots.next.startsAt)} · {slots.next.employeeName}</span><button type="button" className="button button-secondary" onClick={() => { if (!slots.next) return; setPendingSlotStart(slots.next.startsAt); setDate(dateInAlmaty(slots.next.startsAt)); setEmployeeId(slots.next.employeeId); window.Telegram?.WebApp.HapticFeedback?.selectionChanged?.(); }}>Выбрать это окно</button></div> : <EmptyState title="На ближайшие 14 дней окон нет" description="Можно выбрать другой день или встать в лист ожидания." action={<Button variant="secondary" onClick={() => void joinWaitlist()}><RefreshCw size={14} /> Лист ожидания</Button>} />}</section> : null}
        {selectedSlot ? <section className="booking-confirm-card"><div><span>Проверьте запись</span><strong>{formatDateTime(selectedSlot.startsAt)}</strong><small>{currentService?.name} · {formatCurrency(Number(currentService?.price || 0))} · {selectedSlot.employeeName} · {currentBranch?.name}</small></div><button type="button" className="button button-primary" onClick={() => void book()} disabled={saving}>{saving ? "Подтверждаем…" : rescheduleId ? "Перенести запись" : "Подтвердить запись"}<Check size={15} /></button></section> : null}
        {notice ? <p className="client-notice">{notice}</p> : null}
      </>}
    </>
  );
}

export function ClientAppointmentsView() {
  const { data, loading, error, reload } = useApi<AppointmentResponse>("/api/client/appointments");
  const [cancelTarget, setCancelTarget] = useState<ClientAppointment | null>(null);
  const [rebookItem, setRebookItem] = useState<ClientAppointment | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  async function cancel() {
    if (!cancelTarget || cancelling) return;
    setCancelling(true);
    setNotice(null);
    try {
      await apiFetch(`/api/client/appointments/${cancelTarget.id}`, { method: "PATCH", body: { reason: "Отменено клиентом" } });
      dispatchCrmEvent("crm:data-changed");
      setRebookItem(cancelTarget);
      setCancelTarget(null);
      setNotice("Запись отменена. Если планы изменятся, можно выбрать новое время.");
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred?.("success");
      await reload();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Не удалось отменить запись");
    } finally {
      setCancelling(false);
    }
  }
  if (loading && !data) return <LoadingState label="Загружаем ваши записи…" />;
  if (error && isAuthError(error)) return <AuthHint />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  const items = data?.items ?? [];
  const now = Date.now();
  const upcoming = items.filter((item) => !["cancelled", "completed", "no_show"].includes(statusKey(item.status)) && new Date(item.startsAt).getTime() > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const cancelled = items.filter((item) => statusKey(item.status) === "cancelled").sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const past = items.filter((item) => statusKey(item.status) !== "cancelled" && !upcoming.some((candidate) => candidate.id === item.id)).sort((a, b) => b.startsAt.localeCompare(a.startsAt));

  function renderAppointment(item: ClientAppointment) {
    const status = statusKey(item.status);
    const isCancelTarget = cancelTarget?.id === item.id;
    return <article className="client-appointment-card" id={`appointment-${item.id}`} key={item.id}><div className="client-appointment-top"><div><span className="client-appointment-date">{formatDateTime(item.startsAt)}</span><strong>{item.serviceName ?? "Приём в podologymk"}</strong></div><StatusPill status={status} /></div><div className="client-appointment-meta"><span><UserRound size={14} /> {item.employeeName ?? "Специалист"}</span><span><MapPin size={14} /> {item.branchName ?? "Филиал"}</span><Amount value={Number(item.amount || 0)} /></div>{item.checkInToken && ["scheduled", "confirmed"].includes(status) ? <div className="client-checkin-code"><span>Код для администратора</span><strong>{item.checkInToken}</strong></div> : null}{isCancelTarget ? <div className="client-cancel-confirm"><strong>Отменить эту запись?</strong><span>{formatDateTime(item.startsAt)} · {item.serviceName ?? "Приём"}</span><div><button type="button" className="button button-ghost" onClick={() => setCancelTarget(null)} disabled={cancelling}>Оставить запись</button><button type="button" className="button button-danger" onClick={() => void cancel()} disabled={cancelling}>{cancelling ? "Отменяем…" : "Да, отменить"}</button></div></div> : <div className="client-appointment-actions">{item.canCancel ? <><Link href={`/client/book?reschedule=${item.id}`} className="button button-secondary">Перенести</Link><button type="button" className="button button-ghost danger-text" onClick={() => { setNotice(null); setCancelTarget(item); }}>Отменить</button></> : null}{status === "completed" && !item.reviewId ? <Link href={`/client/reviews?appointment=${item.id}`} className="button button-ghost"><Star size={14} /> Оставить отзыв</Link> : null}{status === "completed" ? <Link href={bookAgainHref(item)} className="button button-ghost"><RefreshCw size={14} /> Повторить запись</Link> : null}</div>}</article>;
  }

  function renderGroup(title: string, group: ClientAppointment[]) {
    if (!group.length) return null;
    return <section className="client-appointment-group"><h2>{title}</h2><div className="client-appointment-list">{group.map(renderAppointment)}</div></section>;
  }

  return <><Link href="/" className="client-back-link"><ChevronLeft size={17} /> В кабинет</Link><div className="client-greeting compact"><p className="client-eyebrow">История</p><h1>Мои записи</h1><p>Предстоящие визиты, история и быстрый повтор записи.</p></div>{notice ? <div className="client-notice client-notice-success" role="status"><span>{notice}</span>{rebookItem ? <Link href={bookAgainHref(rebookItem)} className="button button-secondary">Записаться снова</Link> : null}</div> : null}{items.length === 0 ? <EmptyState title="Записей пока нет" description="Выберите услугу и удобное время для первого визита." action={<Link href="/client/book" className="button button-primary">Записаться</Link>} /> : <>{renderGroup("Предстоящие", upcoming)}{renderGroup("Прошедшие", past)}{renderGroup("Отменённые", cancelled)}</>}</>;
}

export function ClientLoyaltyView() {
  const { data, loading, error, reload } = useApi<LoyaltyResponse>("/api/client/loyalty");
  if (loading && !data) return <LoadingState label="Загружаем бонусы…" />;
  if (error && isAuthError(error)) return <AuthHint />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  return <><Link href="/" className="client-back-link"><ChevronLeft size={17} /> В кабинет</Link><div className="client-greeting compact"><p className="client-eyebrow">Лояльность</p><h1>Ваши бонусы</h1><p>Бонусы начисляются за завершённые приёмы.</p></div><section className="loyalty-balance-card"><Gift size={25} /><div><span>Доступно сейчас</span><strong>{data.account.pointsBalance}</strong><small>баллов</small></div><div className="loyalty-lifetime">Всего заработано<br /><b>{data.account.lifetimePoints}</b></div></section><SectionCard title="История бонусов" subtitle="Начисления появляются после завершения визита">{data.transactions.length === 0 ? <EmptyState title="История пока пустая" description="После первого завершённого приёма здесь появятся бонусы." /> : <div className="loyalty-history">{data.transactions.map((transaction) => <div className="loyalty-row" key={transaction.id}><span className={`loyalty-row-icon ${transaction.points >= 0 ? "loyalty-positive" : "loyalty-negative"}`}>{transaction.points >= 0 ? "+" : "−"}</span><div><strong>{transaction.description}</strong><small>{formatDateTime(transaction.createdAt)}</small></div><b>{transaction.points > 0 ? "+" : ""}{transaction.points}</b></div>)}</div>}</SectionCard></>;
}

export function ClientProfileView() {
  const { data, loading, error, reload } = useApi<ProfileResponse>("/api/client/profile");
  const [saving, setSaving] = useState(false);
  const [allowReminders, setAllowReminders] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (data) setAllowReminders(Boolean(data.user.notificationsAllowed || data.consents.some((consent) => consent.kind === "REMINDERS"))); }, [data]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    setFieldErrors({});
    const body: Record<string, unknown> = Object.fromEntries(new FormData(event.currentTarget).entries());
    body.allowReminders = allowReminders;
    try { await apiFetch("/api/client/profile", { method: "POST", body }); window.Telegram?.WebApp.hideKeyboard?.(); window.Telegram?.WebApp.HapticFeedback?.notificationOccurred?.("success"); dispatchCrmEvent("crm:data-changed"); setNotice("Профиль сохранён"); setEditing(false); await reload(); } catch (cause) { if (cause instanceof ApiError) { setNotice(cause.message); setFieldErrors(cause.fieldErrors); if (Object.keys(cause.fieldErrors).length) focusFirstInvalid(); window.Telegram?.WebApp.HapticFeedback?.notificationOccurred?.("error"); } else setNotice(cause instanceof Error ? cause.message : "Не удалось сохранить профиль"); } finally { setSaving(false); }
  }
  function requestReminders() {
    const webApp = window.Telegram?.WebApp;
    if (webApp?.requestWriteAccess) webApp.requestWriteAccess((allowed) => {
      setAllowReminders(allowed);
      setNotice(allowed ? "Напоминания включены" : "Разрешение не предоставлено");
      if (data?.profile) {
        void apiFetch("/api/client/profile", { method: "POST", body: { fullName: data.profile.fullName, phone: data.profile.phone, email: data.profile.email ?? "", allowReminders: allowed } })
          .then(() => reload())
          .catch(() => setNotice("Разрешение получено, сохраните профиль ещё раз"));
      }
    });
    else setNotice("Откройте Mini App в Telegram, чтобы включить напоминания");
  }
  if (loading && !data) return <LoadingState label="Загружаем профиль…" />;
  if (error && isAuthError(error)) return <AuthHint />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data?.profile) return <ClientOnboarding prefillName={data?.user.name?.startsWith("Пользователь podologymk") ? "" : data?.user.name} onComplete={() => void reload()} />;
  return <><Link href="/" className="client-back-link"><ChevronLeft size={17} /> В кабинет</Link><section className="client-account-card"><div className="client-account-heading"><span className="client-account-avatar">{initials(data.profile.fullName)}</span><div><p className="client-eyebrow">Личный кабинет</p><h1>{data.profile.fullName}</h1><span>{data.profile.phone}</span></div><button type="button" className="button button-secondary" onClick={() => { setNotice(null); setFieldErrors({}); setEditing(true); }}>Изменить</button></div></section>{editing ? <form className="client-profile-form" onSubmit={save}><div className="client-form-section-title">Личные данные</div><FormField label="Имя и фамилия" error={fieldErrors.fullName} errorId="profile-full-name-error"><input name="fullName" required autoComplete="name" defaultValue={data.profile.fullName} aria-invalid={Boolean(fieldErrors.fullName)} aria-describedby={fieldErrors.fullName ? "profile-full-name-error" : undefined} /></FormField><FormField label="Телефон" error={fieldErrors.phone} errorId="profile-phone-error"><PhoneInput required defaultValue={data.profile.phone} enterKeyHint="next" aria-invalid={Boolean(fieldErrors.phone)} aria-describedby={fieldErrors.phone ? "profile-phone-error" : undefined} /></FormField><FormField label="Email"><input name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} defaultValue={data.profile.email ?? ""} /></FormField><label className="consent-row"><input name="allowReminders" type="checkbox" checked={allowReminders} onChange={(event) => setAllowReminders(event.target.checked)} /><span><strong>Напоминать о записи в Telegram</strong><small>Без рекламных сообщений</small></span></label><div className="client-profile-actions"><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Сохраняем…" : "Сохранить"}</button><Button variant="secondary" onClick={() => setEditing(false)}>Отмена</Button></div>{notice ? <p className="client-notice">{notice}</p> : null}</form> : <><section className="client-profile-summary"><p className="client-form-section-title">Личные данные</p><div><span>Имя</span><strong>{data.profile.fullName}</strong></div><div><span>Телефон</span><strong>{data.profile.phone}</strong></div><div><span>Email</span><strong>{data.profile.email || "Не указан"}</strong></div></section><section className="client-preference-card"><div><strong>Напоминания</strong><span>{allowReminders ? "Напоминать о записи в Telegram" : "Напоминания выключены"}</span></div>{allowReminders ? <span className="preference-status">Включены</span> : <Button variant="secondary" onClick={requestReminders}>Включить</Button>}</section><button type="button" className="client-help-card" onClick={openSupport}><MessageCircle size={19} /><div><strong>Помощь</strong><span>Написать администратору через Telegram</span></div><ArrowRight size={16} /></button></>}{notice && !editing ? <p className="client-notice">{notice}</p> : null}<section className="client-privacy-card"><ShieldCheck size={18} /><div><strong>Ваши данные защищены</strong><span>Клинические заметки и внутренние записи специалиста не показываются в клиентском кабинете.</span></div></section></>;
}

export function ClientReviewsView() {
  const searchParams = useSearchParams();
  const initialAppointment = searchParams.get("appointment") ?? "";
  const { data, loading, error, reload } = useApi<ReviewsResponse>("/api/client/reviews");
  const [appointmentId, setAppointmentId] = useState(initialAppointment);
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const available = (data?.items ?? []).filter((item) => !item.reviewId);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try { await apiFetch("/api/client/reviews", { method: "POST", body: { appointmentId, rating, reviewText: text } }); setNotice("Спасибо за отзыв!"); setText(""); dispatchCrmEvent("crm:data-changed"); await reload(); } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Не удалось сохранить отзыв"); } finally { setSaving(false); }
  }
  if (loading && !data) return <LoadingState label="Загружаем отзывы…" />;
  if (error && isAuthError(error)) return <AuthHint />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  return <><Link href="/" className="client-back-link"><ChevronLeft size={17} /> В кабинет</Link><div className="client-greeting compact"><p className="client-eyebrow">Обратная связь</p><h1>Ваше мнение важно</h1><p>Оцените визит — это помогает нам становиться лучше.</p></div>{available.length ? <form className="review-form" onSubmit={submit}><FormField label="Приём"><select value={appointmentId} onChange={(event) => setAppointmentId(event.target.value)} required><option value="">Выберите завершённый визит</option>{available.map((item) => <option key={item.appointmentId} value={item.appointmentId}>{formatDateTime(item.startsAt)} · {item.serviceName ?? "Приём"}</option>)}</select></FormField><div className="rating-picker"><span>Оценка</span><div>{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" className={value <= rating ? "rating-star rating-star-active" : "rating-star"} onClick={() => setRating(value)} aria-label={`${value} из 5`}><Star size={25} fill="currentColor" /></button>)}</div></div><FormField label="Комментарий"><textarea rows={4} value={text} onChange={(event) => setText(event.target.value)} placeholder="Что понравилось или что можно улучшить?" /></FormField><button className="button button-primary client-wide-button" type="submit" disabled={saving || !appointmentId}>{saving ? "Отправляем…" : "Оставить отзыв"}</button>{notice ? <p className="client-notice">{notice}</p> : null}</form> : <EmptyState title="Все визиты уже оценены" description="Спасибо, что помогаете podologymk становиться лучше." />}{(data?.items ?? []).filter((item) => item.reviewId).length ? <section className="client-review-history"><h2>Ваши отзывы</h2>{(data?.items ?? []).filter((item) => item.reviewId).map((item) => <div key={item.reviewId} className="review-history-row"><div>{Array.from({ length: item.rating ?? 0 }).map((_, index) => <Star key={index} size={14} fill="currentColor" />)}</div><p>{item.reviewText || "Без комментария"}</p><small>{formatDateTime(item.startsAt)}</small></div>)}</section> : null}</>;
}
