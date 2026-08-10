"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, Check, ChevronLeft, Clock3, Gift, MapPin, MessageCircle, RefreshCw, ShieldCheck, Star, UserRound } from "lucide-react";

import { apiFetch, dispatchCrmEvent } from "@/lib/api-client";
import { AuthHint, EmptyState, ErrorState, FormField, isAuthError, LoadingState } from "@/components/data-state";
import { Amount, Button, SectionCard, StatusPill } from "@/components/ui";
import type { AvailabilitySlot, Branch, ClientAppointment, LoyaltyResponse, ServiceRecord } from "@/lib/crm-types";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { useApi } from "@/lib/use-api";

type ClientProfile = { id: string; fullName: string; phone: string; email: string | null; notes?: string | null; pointsBalance?: number };
type ProfileResponse = { ok: true; user: { name: string; phone: string | null; notificationsAllowed: number }; profile: ClientProfile | null; consents: Array<{ kind: string; version: string }> };
type CatalogResponse = { ok: true; profile: ClientProfile | null; services: ServiceRecord[]; branches: Branch[] };
type AppointmentResponse = { ok: true; items: ClientAppointment[] };
type SlotResponse = { ok: true; items: AvailabilitySlot[] };
type ReviewItem = { appointmentId: string; startsAt: string; amount: number; serviceName: string | null; reviewId: string | null; rating: number | null; reviewText: string | null; status: string | null };
type ReviewsResponse = { ok: true; items: ReviewItem[] };

function todayValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${value}T12:00:00`));
}

function statusKey(status: string) {
  return status.toLowerCase();
}

export function ClientOnboarding({ onComplete }: { onComplete?: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const formData = new FormData(event.currentTarget);
    const body: Record<string, unknown> = Object.fromEntries(formData.entries());
    body.allowReminders = formData.get("allowReminders") === "on";
    try {
      await apiFetch("/api/client/profile", { method: "POST", body });
      dispatchCrmEvent("crm:data-changed");
      onComplete?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить профиль");
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
        <FormField label="Имя и фамилия"><input name="fullName" required placeholder="Как к вам обращаться" autoFocus /></FormField>
        <FormField label="Телефон"><input name="phone" required placeholder="+7 700 000 00 00" /></FormField>
        <FormField label="Email, если удобно"><input name="email" type="email" placeholder="Для чека и связи" /></FormField>
        <label className="consent-row"><input name="allowReminders" type="checkbox" defaultChecked /><span><strong>Напоминать о визитах в Telegram</strong><small>Без рекламных сообщений без отдельного согласия</small></span></label>
        {error ? <p className="form-error">{error}</p> : null}
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
  if (data && !data.profile) return <ClientOnboarding onComplete={() => void reload()} />;
  if (!data?.profile) return null;

  return (
    <>
      <div className="client-greeting"><p className="client-eyebrow">Личный кабинет</p><h1>Здравствуйте, {data.profile.fullName.split(" ")[0]} 👋</h1><p>Здесь всё для вашего следующего визита.</p></div>
      <Link href="/client/book" className="client-primary-card"><span className="client-primary-icon"><CalendarDays size={22} /></span><span><strong>Записаться на приём</strong><small>Выберите услугу и удобное время</small></span><ArrowRight size={19} /></Link>

      {nextAppointment ? <section className="next-appointment-card"><div className="next-card-heading"><span>Ближайший визит</span><StatusPill status={statusKey(nextAppointment.status)} /></div><strong className="next-card-service">{nextAppointment.serviceName ?? "Приём в podologymk"}</strong><div className="next-card-details"><span><CalendarDays size={15} /> {formatDateTime(nextAppointment.startsAt)}</span><span><Clock3 size={15} /> {nextAppointment.employeeName ?? "Специалист"}</span><span><MapPin size={15} /> {nextAppointment.branchName ?? "Филиал уточняется"}</span></div><div className="next-card-actions"><Link href="/client/appointments" className="button button-secondary">Подробнее</Link><Link href={`/client/book?reschedule=${nextAppointment.id}`} className="button button-ghost">Перенести</Link></div></section> : <EmptyState title="Ближайших визитов пока нет" description="Выберите услугу — система покажет только реальные свободные окна." action={<Link href="/client/book" className="button button-primary">Записаться</Link>} />}

      <div className="client-stat-grid"><Link href="/client/loyalty" className="client-stat-card"><span className="client-stat-icon client-stat-gift"><Gift size={18} /></span><span><small>Ваши бонусы</small><strong>{loyalty?.account.pointsBalance ?? 0} баллов</strong></span></Link><Link href="/client/appointments" className="client-stat-card"><span className="client-stat-icon client-stat-calendar"><CalendarDays size={18} /></span><span><small>Всего визитов</small><strong>{appointments?.items.filter((item) => statusKey(item.status) === "completed").length ?? 0}</strong></span></Link></div>

      <section className="client-help-card"><MessageCircle size={19} /><div><strong>Нужна помощь?</strong><span>Напишите администратору через Telegram</span></div><ArrowRight size={16} /></section>
    </>
  );
}

export function ClientBookingView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rescheduleId = searchParams.get("reschedule") ?? "";
  const { data: catalog, loading, error, reload } = useApi<CatalogResponse>("/api/client/catalog");
  const [branchId, setBranchId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState(todayValue);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const slotsPath = branchId && serviceId && date ? `/api/client/availability?date=${date}&branchId=${branchId}&serviceId=${serviceId}` : "";
  const { data: slots, loading: slotsLoading, error: slotsError } = useApi<SlotResponse>(slotsPath, undefined, { enabled: Boolean(slotsPath) });
  const currentService = catalog?.services.find((service) => service.id === serviceId);

  useEffect(() => { setSelectedSlot(null); }, [branchId, serviceId, date]);

  async function book() {
    if (!selectedSlot) return;
    setSaving(true);
    setNotice(null);
    try {
      await apiFetch("/api/client/appointments", { method: "POST", body: { startsAt: selectedSlot.startsAt, serviceId, branchId, employeeId: selectedSlot.employeeId, ...(rescheduleId ? { appointmentId: rescheduleId } : {}) } });
      dispatchCrmEvent("crm:data-changed");
      router.push("/client/appointments");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Не удалось создать запись");
    } finally {
      setSaving(false);
    }
  }

  async function joinWaitlist() {
    try {
      await apiFetch("/api/client/waitlist", { method: "POST", body: { serviceId, branchId, preferredDate: date } });
      setNotice("Готово. Мы сообщим, когда появится подходящее окно.");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Не удалось добавить в лист ожидания");
    }
  }

  if (loading && !catalog) return <LoadingState label="Загружаем услуги и филиалы…" />;
  if (error && isAuthError(error)) return <AuthHint />;
  if (error && !catalog) return <ErrorState message={error} onRetry={reload} />;
  if (catalog && !catalog.profile) return <ClientOnboarding onComplete={() => void reload()} />;
  if (!catalog) return null;

  return (
    <>
      <Link href="/" className="client-back-link"><ChevronLeft size={17} /> В кабинет</Link>
      <div className="client-greeting compact"><p className="client-eyebrow">Новая запись</p><h1>{rescheduleId ? "Выберите новое время" : "Когда вам удобно?"}</h1><p>Покажем только реальные доступные окна.</p></div>
      {catalog.services.length === 0 || catalog.branches.length === 0 ? <EmptyState title="Запись пока не настроена" description="Администратору нужно добавить филиал и услуги в каталоге podologymk." /> : <>
        <section className="client-step-card"><div className="client-step-title"><span>1</span><div><strong>Выберите услугу</strong><small>Продолжительность и цена указаны сразу</small></div></div><div className="choice-grid">{catalog.services.map((service) => <button key={service.id} className={`choice-card ${service.id === serviceId ? "choice-card-selected" : ""}`} onClick={() => setServiceId(service.id)}><span><strong>{service.name}</strong><small>{service.category} · {service.durationMinutes} мин</small></span><b>{formatCurrency(Number(service.price || 0))}</b></button>)}</div></section>
        <section className="client-step-card"><div className="client-step-title"><span>2</span><div><strong>Выберите филиал</strong><small>Где вам будет удобнее</small></div></div><div className="choice-grid">{catalog.branches.map((branch) => <button key={branch.id} className={`choice-card ${branch.id === branchId ? "choice-card-selected" : ""}`} onClick={() => setBranchId(branch.id)}><span><strong>{branch.name}</strong><small>{branch.address || "Адрес уточняется"}</small></span><MapPin size={17} /></button>)}</div></section>
        <section className="client-step-card"><div className="client-step-title"><span>3</span><div><strong>Выберите день</strong><small>{dateLabel(date)}</small></div></div><input className="client-date-input" type="date" value={date} min={todayValue()} onChange={(event) => setDate(event.target.value)} /></section>
        {branchId && serviceId ? <section className="client-step-card"><div className="client-step-title"><span>4</span><div><strong>Свободные окна</strong><small>{currentService ? `${currentService.name} · ${formatCurrency(Number(currentService.price || 0))}` : "Выберите услугу"}</small></div></div>{slotsLoading ? <LoadingState label="Проверяем расписание…" /> : slotsError ? <ErrorState message={slotsError} onRetry={() => undefined} /> : slots?.items.length ? <div className="slot-grid">{slots.items.map((slot) => <button key={`${slot.employeeId}-${slot.startsAt}`} className={`slot-button ${selectedSlot?.startsAt === slot.startsAt && selectedSlot.employeeId === slot.employeeId ? "slot-button-selected" : ""}`} onClick={() => setSelectedSlot(slot)}><strong>{new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" }).format(new Date(slot.startsAt))}</strong><small>{slot.employeeName}</small></button>)}</div> : <EmptyState title="На этот день окон нет" description="Можно выбрать другой день или встать в лист ожидания." action={<Button variant="secondary" onClick={() => void joinWaitlist()}><RefreshCw size={14} /> Лист ожидания</Button>} />}</section> : null}
        {selectedSlot ? <section className="booking-confirm-card"><div><span>Вы выбрали</span><strong>{formatDateTime(selectedSlot.startsAt)}</strong><small>{selectedSlot.employeeName} · {catalog.branches.find((branch) => branch.id === branchId)?.name}</small></div><button className="button button-primary" onClick={() => void book()} disabled={saving}>{saving ? "Подтверждаем…" : rescheduleId ? "Перенести запись" : "Подтвердить запись"}<Check size={15} /></button></section> : null}
        {notice ? <p className="client-notice">{notice}</p> : null}
      </>}
    </>
  );
}

export function ClientAppointmentsView() {
  const { data, loading, error, reload } = useApi<AppointmentResponse>("/api/client/appointments");
  async function cancel(id: string) {
    if (!window.confirm("Отменить эту запись?")) return;
    try {
      await apiFetch(`/api/client/appointments/${id}`, { method: "PATCH", body: { reason: "Отменено клиентом" } });
      dispatchCrmEvent("crm:data-changed");
      await reload();
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : "Не удалось отменить запись");
    }
  }
  if (loading && !data) return <LoadingState label="Загружаем ваши записи…" />;
  if (error && isAuthError(error)) return <AuthHint />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  const items = data?.items ?? [];
  return <><Link href="/" className="client-back-link"><ChevronLeft size={17} /> В кабинет</Link><div className="client-greeting compact"><p className="client-eyebrow">История</p><h1>Мои записи</h1><p>Все будущие и завершённые визиты в одном месте.</p></div>{items.length === 0 ? <EmptyState title="Записей пока нет" description="Выберите услугу и удобное время для первого визита." action={<Link href="/client/book" className="button button-primary">Записаться</Link>} /> : <div className="client-appointment-list">{items.map((item) => <article className="client-appointment-card" key={item.id}><div className="client-appointment-top"><div><span className="client-appointment-date">{formatDateTime(item.startsAt)}</span><strong>{item.serviceName ?? "Приём в podologymk"}</strong></div><StatusPill status={statusKey(item.status)} /></div><div className="client-appointment-meta"><span><UserRound size={14} /> {item.employeeName ?? "Специалист"}</span><span><MapPin size={14} /> {item.branchName ?? "Филиал"}</span><Amount value={Number(item.amount || 0)} /></div>{item.checkInToken && ["scheduled", "confirmed"].includes(statusKey(item.status)) ? <div className="client-checkin-code"><span>Код для администратора</span><strong>{item.checkInToken}</strong></div> : null}<div className="client-appointment-actions">{item.canCancel ? <><Link href={`/client/book?reschedule=${item.id}`} className="button button-secondary">Перенести</Link><button className="button button-ghost danger-text" onClick={() => void cancel(item.id)}>Отменить</button></> : null}{statusKey(item.status) === "completed" && !item.reviewId ? <Link href={`/client/reviews?appointment=${item.id}`} className="button button-ghost"><Star size={14} /> Оставить отзыв</Link> : null}</div></article>)}</div>}</>;
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
  useEffect(() => { if (data) setAllowReminders(Boolean(data.user.notificationsAllowed || data.consents.some((consent) => consent.kind === "REMINDERS"))); }, [data]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    const body: Record<string, unknown> = Object.fromEntries(new FormData(event.currentTarget).entries());
    body.allowReminders = allowReminders;
    try { await apiFetch("/api/client/profile", { method: "POST", body }); dispatchCrmEvent("crm:data-changed"); setNotice("Профиль сохранён"); await reload(); } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Не удалось сохранить профиль"); } finally { setSaving(false); }
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
  if (!data?.profile) return <ClientOnboarding onComplete={() => void reload()} />;
  return <><Link href="/" className="client-back-link"><ChevronLeft size={17} /> В кабинет</Link><div className="client-greeting compact"><p className="client-eyebrow">Ваши данные</p><h1>Профиль</h1><p>Проверьте, как с вами связаться.</p></div><form className="client-profile-form" onSubmit={save}><FormField label="Имя и фамилия"><input name="fullName" required defaultValue={data.profile.fullName} /></FormField><FormField label="Телефон"><input name="phone" required defaultValue={data.profile.phone} /></FormField><FormField label="Email"><input name="email" type="email" defaultValue={data.profile.email ?? "" } /></FormField><label className="consent-row"><input type="checkbox" checked={allowReminders} onChange={(event) => setAllowReminders(event.target.checked)} /><span><strong>Получать напоминания</strong><small>Система отправит подтверждение и напоминание о визите</small></span></label><div className="client-profile-actions"><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Сохраняем…" : "Сохранить"}</button>{!allowReminders ? <Button variant="secondary" onClick={requestReminders}>Разрешить Telegram-уведомления</Button> : null}</div>{notice ? <p className="client-notice">{notice}</p> : null}</form><section className="client-privacy-card"><ShieldCheck size={18} /><div><strong>Ваши данные защищены</strong><span>Клинические заметки и внутренние записи специалиста не показываются в клиентском кабинете.</span></div></section></>;
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
