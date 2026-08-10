"use client";

import Link from "next/link";
import { ChevronLeft, Clock3, FileText, History, Phone, UserRound } from "lucide-react";
import { AuthHint, EmptyState, ErrorState, isAuthError, LoadingState } from "@/components/data-state";
import { Amount, Avatar, PageHeader, SectionCard, StatusPill } from "@/components/ui";
import { formatCurrency, formatDateTime, initials } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useEffect, useState } from "react";

type ClientDetail = {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  isActive: number;
  visits: number;
  lastVisit: string | null;
  nextVisit: string | null;
  total: number;
};

type DetailResponse = {
  ok: true;
  client: ClientDetail;
  appointments: Array<{ id: string; startsAt: string; endsAt?: string | null; status: string; amount: number; paidAmount: number; serviceName: string | null; employeeName: string | null; branchName: string | null; cancelReason: string | null }>;
  payments: Array<{ id: string; amount: number; method: string; status: string; paidAt: string; serviceName: string | null }>;
  timeline: Array<{ type: string; entityId: string; occurredAt: string; action: string; title: string; details: string | null }>;
};

export function ClientDetailView({ clientId }: { clientId: string }) {
  const [resolvedId, setResolvedId] = useState(clientId);
  useEffect(() => {
    const segments = window.location.pathname.split("/").filter(Boolean);
    if (segments[0] === "clients" && segments[1] && segments[1] !== "placeholder") setResolvedId(decodeURIComponent(segments[1]));
  }, [clientId]);
  const { data, loading, error, reload } = useApi<DetailResponse>(`/api/clients/${encodeURIComponent(resolvedId)}`, undefined, { enabled: Boolean(resolvedId) });
  const client = data?.client;
  return (
    <>
      <Link href="/clients" className="client-back-link"><ChevronLeft size={17} /> Все клиенты</Link>
      {loading && !data ? <LoadingState /> : null}
      {error && isAuthError(error) ? <AuthHint /> : null}
      {error && !isAuthError(error) ? <ErrorState message={error} onRetry={reload} /> : null}
      {client ? <>
        <PageHeader eyebrow="Карточка клиента" title={client.fullName} description={`${client.phone}${client.email ? ` · ${client.email}` : ""}`} actions={<a className="button button-primary" href={`tel:${client.phone}`}><Phone size={15} /> Позвонить</a>} />
        <div className="client-profile-grid">
          <SectionCard title="Профиль" subtitle="Основная информация">
            <div className="client-profile-heading"><Avatar initials={initials(client.fullName)} tone="violet" /><div><strong>{client.fullName}</strong><span>{client.isActive ? "Активный клиент" : "В архиве"}</span></div></div>
            <div className="client-facts"><div><Phone size={15} /><span>{client.phone}</span></div>{client.email ? <div><UserRound size={15} /><span>{client.email}</span></div> : null}<div><Clock3 size={15} /><span>В базе с {formatDateTime(client.createdAt)}</span></div></div>
            {client.notes ? <div className="client-notes"><FileText size={15} /><span>{client.notes}</span></div> : null}
          </SectionCard>
          <SectionCard title="Итоги клиента" subtitle="Фактические данные из базы">
            <div className="summary-list"><div className="summary-row"><span>Завершённых визитов</span><strong>{client.visits}</strong></div><div className="summary-row"><span>Оплачено</span><strong>{formatCurrency(Number(client.total || 0))}</strong></div><div className="summary-row"><span>Последний визит</span><strong>{client.lastVisit ? formatDateTime(client.lastVisit) : "—"}</strong></div><div className="summary-row"><span>Следующий визит</span><strong>{client.nextVisit ? formatDateTime(client.nextVisit) : "—"}</strong></div></div>
          </SectionCard>
        </div>
        <SectionCard title="История записей" subtitle={`${data.appointments.length} записей`}>
          {data.appointments.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Дата</th><th>Услуга</th><th>Специалист</th><th>Статус</th><th>Оплата</th><th>Сумма</th></tr></thead><tbody>{data.appointments.map((item) => <tr key={item.id}><td>{formatDateTime(item.startsAt)}</td><td>{item.serviceName ?? "—"}<span className="table-secondary">{item.branchName ?? ""}</span></td><td>{item.employeeName ?? "—"}</td><td><StatusPill status={item.status.toLowerCase()} />{item.cancelReason ? <span className="table-secondary">{item.cancelReason}</span> : null}</td><td><Amount value={Number(item.paidAmount || 0)} /></td><td><Amount value={Number(item.amount || 0)} /></td></tr>)}</tbody></table></div> : <EmptyState title="История пока пустая" description="Записи клиента появятся здесь после создания первой записи." />}
        </SectionCard>
        <div className="dashboard-grid dashboard-grid-equal page-section">
          <SectionCard title="Платежи" subtitle="Проведённые операции"><div className="summary-list">{data.payments.length ? data.payments.map((payment) => <div className="summary-row" key={payment.id}><span><strong>{formatCurrency(Number(payment.amount || 0))}</strong><small className="table-secondary">{payment.method} · {formatDateTime(payment.paidAt)}</small></span><StatusPill status={payment.status.toLowerCase()} /></div>) : <EmptyState title="Оплат нет" description="Оплаты по завершённым приёмам будут отображаться здесь." />}</div></SectionCard>
          <SectionCard title="Timeline" subtitle="Изменения и действия по клиенту"><div className="timeline-list">{data.timeline.length ? data.timeline.map((entry) => <div className="timeline-item" key={`${entry.type}-${entry.entityId}-${entry.occurredAt}`}><span className="timeline-dot"><History size={13} /></span><div><strong>{entry.title}</strong><span>{entry.action} · {formatDateTime(entry.occurredAt)}</span>{entry.details ? <small>{entry.details}</small> : null}</div></div>) : <EmptyState title="Событий пока нет" description="История действий появится автоматически." />}</div></SectionCard>
        </div>
      </> : null}
    </>
  );
}
