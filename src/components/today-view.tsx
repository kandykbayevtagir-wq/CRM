"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ArrowRight, CalendarDays, Check, Phone, RefreshCw, ShieldCheck } from "lucide-react";
import { apiFetch, dispatchCrmEvent, selectedBranch } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { useOperationKey } from "@/lib/use-operation-key";
import type { AppointmentRecord } from "@/lib/crm-types";
import { localDate } from "@/lib/appointments/schedule";
import { formatCurrency } from "@/lib/format";
import { Amount, Button, PageHeader, SectionCard, StatusPill } from "@/components/ui";
import { ErrorState, LoadingState, EmptyState, Modal, FormField } from "@/components/data-state";

type Visit = AppointmentRecord & { clientId: string; revision: number };
type Operations = {
  date: string; timezone: string; items: Visit[];
  queue: { status: string; count: number }[];
  failures: { id: string; kind: string; errorCode: string; attempts: number }[];
  worker: { status: string; completedAt: string | null } | null; workerStale: boolean;
  overdueBalances: { count: number };
};
const nextStatus: Record<string, { status: string; label: string }> = {
  SCHEDULED: { status: "CONFIRMED", label: "Подтвердить" },
  CONFIRMED: { status: "ARRIVED", label: "Клиент пришёл" },
  ARRIVED: { status: "IN_PROGRESS", label: "Начать приём" },
  IN_PROGRESS: { status: "COMPLETED", label: "Завершить" },
};

export function TodayView() {
  const [date, setDate] = useState(() => localDate(new Date(), "Asia/Almaty"));
  const [filter, setFilter] = useState("all");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [payment, setPayment] = useState<Visit | null>(null);
  const [cancellation, setCancellation] = useState<Visit | null>(null);
  const [completion, setCompletion] = useState<Visit | null>(null);
  const paymentKey = useOperationKey();
  const branch = selectedBranch();
  const { data, loading, error, reload } = useApi<Operations>("/api/operations?" + new URLSearchParams({ date, branchId: branch }), undefined, { refreshInterval: 60000 });
  const timezone = data?.timezone || "Asia/Almaty";
  const visits = data?.items ?? [];
  const active = visits.filter((visit) => !["CANCELLED", "NO_SHOW"].includes(visit.status));
  const balance = (visit: Visit) => Math.max(0, Number(visit.amount) - Number(visit.paidAmount ?? 0));
  const filtered = visits.filter((visit) => filter === "all" || (filter === "waiting" ? ["SCHEDULED", "CONFIRMED"].includes(visit.status) : filter === "unpaid" ? balance(visit) > 0 && !["CANCELLED","NO_SHOW"].includes(visit.status) : visit.status === filter));
  const displayTime = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, timeStyle: "short" }).format(new Date(value));

  async function transition(visit: Visit, status: string, extra: Record<string, unknown> = {}) {
    if (pendingId) return;
    setPendingId(visit.id); setNotice(null);
    try {
      const result = await apiFetch<{ inventoryWarnings?: { message: string }[] }>("/api/appointments/" + visit.id, { method: "PATCH", body: { status, revision: visit.revision, ...extra } });
      setCompletion(null); setCancellation(null);
      setNotice(result.inventoryWarnings?.length ? result.inventoryWarnings.map((warning) => warning.message).join(" ") : "Изменения сохранены");
      dispatchCrmEvent("crm:data-changed"); await reload();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Не удалось сохранить"); await reload(); }
    finally { setPendingId(null); }
  }
  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payment || pendingId) return;
    const body = { ...Object.fromEntries(new FormData(event.currentTarget)), appointmentId: payment.id };
    setPendingId(payment.id); setNotice(null);
    try {
      await apiFetch("/api/payments", { method: "POST", body: { ...body, idempotencyKey: paymentKey.get(body) } });
      paymentKey.reset(); setPayment(null); setNotice("Оплата проведена"); dispatchCrmEvent("crm:data-changed"); await reload();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Не удалось провести оплату"); }
    finally { setPendingId(null); }
  }
  async function retry(id: string) {
    setPendingId(id); setNotice(null);
    try { await apiFetch("/api/operations", { method: "POST", body: { messageId: id } }); setNotice("Сообщение отправлено на повторную доставку"); await reload(); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : "Не удалось повторить"); }
    finally { setPendingId(null); }
  }
  if (loading && !data) return <LoadingState label="Подготавливаем рабочий день…" />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  return <>
    <PageHeader eyebrow="Рабочее место администратора" title="Сегодня" description="Приёмы, статусы и оплаты — всё для работы центра в одном месте." actions={<><Button variant="secondary" onClick={() => void reload()} loading={loading}><RefreshCw size={16} /> Обновить</Button><Link href="/appointments" className="button button-primary"><CalendarDays size={16} /> Новая запись</Link></>} />
    <div className="reception-stats">
      <div><span>Приёмов</span><strong>{active.length}</strong></div>
      <div><span>Ждём подтверждения</span><strong>{active.filter((visit) => visit.status === "SCHEDULED").length}</strong></div>
      <div><span>В центре</span><strong>{active.filter((visit) => ["ARRIVED","IN_PROGRESS"].includes(visit.status)).length}</strong></div>
      <div><span>Остаток к оплате</span><strong>{formatCurrency(active.reduce((sum, visit) => sum + balance(visit), 0))}</strong></div>
    </div>
    {notice ? <p className="client-notice" role="status">{notice}</p> : null}
    {error && data ? <p className="form-error" role="alert">{error} <button onClick={() => void reload()}>Повторить обновление</button></p> : null}
    <div className="reception-layout">
      <SectionCard title="Лента приёмов" subtitle="Время указано по часовому поясу центра">
        <div className="reception-filters"><label className="filter-select"><span>Дата</span><input type="date" value={date} onChange={(event) => { if(event.target.value) setDate(event.target.value); }} /></label><label className="filter-select"><span>Показать</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Все записи</option><option value="waiting">Ожидаем клиентов</option><option value="ARRIVED">Пришли</option><option value="IN_PROGRESS">В работе</option><option value="COMPLETED">Завершены</option><option value="unpaid">С остатком оплаты</option></select></label></div>
        {!filtered.length ? <EmptyState title="Записей нет" description="Для выбранной даты и фильтра приёмов пока нет." action={<Link href="/appointments" className="button button-secondary">Открыть календарь</Link>} /> : <div className="reception-timeline">{filtered.map((visit) => <article className={"reception-visit reception-visit-" + visit.status.toLowerCase()} key={visit.id}>
          <div className="reception-time"><strong>{displayTime(visit.startsAt)}</strong><small>{visit.endsAt ? displayTime(visit.endsAt) : ""}</small></div>
          <div className="reception-visit-content"><div className="reception-visit-heading"><Link href={"/clients/" + visit.clientId}>{visit.clientName}</Link><StatusPill status={visit.status} /></div><p>{visit.serviceName || "Приём"}</p><small>{[visit.employeeName, visit.branchName].filter(Boolean).join(" · ")}</small><div className="reception-payment"><Amount value={Number(visit.amount)} /><span>{balance(visit) > 0 ? "Осталось " + formatCurrency(balance(visit)) : "Оплачено"}</span></div><div className="reception-actions">
            {nextStatus[visit.status] ? <Button loading={pendingId === visit.id} disabled={Boolean(pendingId)} onClick={() => visit.status === "IN_PROGRESS" ? setCompletion(visit) : void transition(visit, nextStatus[visit.status].status)}><Check size={14} /> {nextStatus[visit.status].label}</Button> : null}
            {!["CANCELLED","NO_SHOW"].includes(visit.status) && balance(visit) > 0 ? <Button variant="secondary" disabled={Boolean(pendingId)} onClick={() => { setNotice(null); setPayment(visit); }}>Принять оплату</Button> : null}
            {visit.clientPhone ? <a className="button button-ghost" href={"tel:+" + visit.clientPhone.replace(/\D/g,"")}><Phone size={14} /> Позвонить</a> : null}
            {["SCHEDULED","CONFIRMED","ARRIVED"].includes(visit.status) ? <Button variant="ghost" disabled={Boolean(pendingId)} onClick={() => { setNotice(null); setCancellation(visit); }}>Отмена / неявка</Button> : null}
          </div></div>
        </article>)}</div>}
      </SectionCard>
      <aside className="reception-attention"><SectionCard title="Требует внимания" subtitle="Незакрытые рабочие вопросы"><div className="attention-links"><Link href="/appointments"><span>Неоплаченные завершённые приёмы <b>{data?.overdueBalances.count ?? 0}</b></span><ArrowRight size={16} /></Link><Link href="/tasks"><span>Задачи команды</span><ArrowRight size={16} /></Link><Link href="/retention"><span>Рекомендованные повторные визиты</span><ArrowRight size={16} /></Link></div></SectionCard>
        <SectionCard title="Доставка Telegram" subtitle={data?.workerStale ? "Проверка фоновой доставки требует внимания" : "Фоновая доставка работает"}><div className={"delivery-status " + (data?.workerStale ? "delivery-status-warning" : "")}><ShieldCheck size={18} /><span>{data?.workerStale ? "Нет свежего отчёта за 15 минут" : "Последняя проверка успешна"}</span></div><div className="delivery-counts">{data?.queue.map((item) => <span key={item.status}><StatusPill status={item.status === "PENDING" ? "queued" : item.status} /> {item.count}</span>)}</div>{data?.failures.map((failure) => <div className="delivery-failure" key={failure.id}><div><strong>{failure.kind === "DIRECT" ? "Ответ бота" : "Уведомление"}</strong><small>{failure.errorCode || "Не доставлено"} · попыток: {failure.attempts}</small></div><Button variant="secondary" disabled={Boolean(pendingId)} onClick={() => void retry(failure.id)}>Повторить</Button></div>)}</SectionCard>
      </aside>
    </div>
    {payment ? <Modal title={"Оплата · " + payment.clientName} onClose={() => { if(!pendingId) setPayment(null); }} footer={<Button type="submit" form="reception-payment-form" loading={Boolean(pendingId)}>Провести оплату</Button>}><form id="reception-payment-form" className="form-grid" onSubmit={pay}><FormField label="Сумма, ₸"><input name="amount" type="number" min="0.01" step="0.01" max={balance(payment)} defaultValue={balance(payment)} required /></FormField><FormField label="Способ оплаты"><select name="method"><option value="CASH">Наличные</option><option value="CARD">Карта</option><option value="QR">QR / Kaspi</option><option value="TRANSFER">Перевод</option></select></FormField>{notice ? <p className="form-error" role="alert">{notice}</p> : null}</form></Modal> : null}
    {cancellation ? <Modal title={"Изменение визита · " + cancellation.clientName} onClose={() => { if(!pendingId) setCancellation(null); }}><form className="form-grid" onSubmit={(event) => { event.preventDefault(); const values=Object.fromEntries(new FormData(event.currentTarget)); void transition(cancellation, String(values.status), { cancelReason: values.reason }); }}><FormField label="Что произошло"><select name="status"><option value="CANCELLED">Запись отменена</option><option value="NO_SHOW">Клиент не пришёл</option></select></FormField><FormField label="Причина"><input name="reason" required maxLength={500} placeholder="Коротко опишите причину" /></FormField><Button type="submit" loading={Boolean(pendingId)}>Сохранить</Button>{notice ? <p className="form-error" role="alert">{notice}</p> : null}</form></Modal> : null}
    {completion ? <Modal title={"Завершение · " + completion.clientName} onClose={() => { if(!pendingId) setCompletion(null); }}><form className="form-grid" onSubmit={(event) => { event.preventDefault(); const values=Object.fromEntries(new FormData(event.currentTarget)); void transition(completion,"COMPLETED", Number(values.days) ? { followUpDays: Number(values.days) } : {}); }}><p>Приём будет завершён; бонусы и расходники будут учтены автоматически.</p><FormField label="Рекомендованный повтор"><select name="days" defaultValue="30"><option value="0">Без напоминания администратору</option><option value="14">Через 2 недели</option><option value="30">Через месяц</option><option value="45">Через 45 дней</option><option value="60">Через 2 месяца</option></select></FormField><Button type="submit" loading={Boolean(pendingId)}>Завершить приём</Button>{notice ? <p className="form-error" role="alert">{notice}</p> : null}</form></Modal> : null}
  </>;
}
