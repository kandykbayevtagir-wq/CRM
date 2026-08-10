"use client";

import Link from "next/link";
import { ArrowRight, CalendarPlus, Plus, WalletCards } from "lucide-react";
import { useMemo } from "react";

import { AuthHint, EmptyState, ErrorState, isAuthError, LoadingState } from "@/components/data-state";
import { Amount, Avatar, MetricCard, PageHeader, SectionCard, StatusPill } from "@/components/ui";
import { formatCompactCurrency, formatCurrency, formatDateTime, initials } from "@/lib/format";
import type { DashboardResponse } from "@/lib/crm-types";
import { useApi } from "@/lib/use-api";

function compactMoney(value: number) {
  return value >= 1_000 ? `${formatCompactCurrency(value)} ₸` : formatCurrency(value);
}

function statusKey(status: string) {
  return status.toLowerCase();
}

export function DashboardView() {
  const { data, loading, error, reload } = useApi<DashboardResponse>("/api/dashboard");
  const metrics = data?.metrics;
  const upcoming = data?.upcoming ?? [];
  const profit = (metrics?.revenue ?? 0) - (metrics?.expenses ?? 0) - (metrics?.payroll ?? 0);
  const expectedRevenue = upcoming.reduce((sum, appointment) => sum + Number(appointment.amount || 0), 0);
  const chart = useMemo(() => {
    const source = data?.revenueByDay ?? [];
    const max = Math.max(...source.map((item) => Number(item.amount || 0)), 1);
    return source.map((item) => ({ ...item, height: Math.max(8, Math.round((Number(item.amount || 0) / max) * 100)) }));
  }, [data?.revenueByDay]);
  const today = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return (
    <>
      <PageHeader
        eyebrow={today}
        title="Рабочий день под контролем"
        description="Актуальные показатели центра синхронизируются с облачной базой и пересчитываются из проведённых операций."
        actions={<Link href="/appointments" className="button button-primary"><Plus size={16} /> Новая запись</Link>}
      />

      {loading && !data ? <LoadingState /> : null}
      {error && isAuthError(error) ? <AuthHint /> : null}
      {error && !isAuthError(error) ? <ErrorState message={error} onRetry={reload} /> : null}

      {data ? <>
        <section className="metrics-grid">
          <MetricCard label="Выручка за месяц" value={compactMoney(metrics?.revenue ?? 0)} change="актуально из D1" trend="neutral" tone="mint" />
          <MetricCard label="Операционный результат" value={compactMoney(profit)} change="выручка − расходы − зарплаты" trend="neutral" tone="lavender" />
          <MetricCard label="Начислено зарплат" value={compactMoney(metrics?.payroll ?? 0)} change="закрытые периоды" trend="neutral" tone="peach" />
          <MetricCard label="Записей за месяц" value={String(metrics?.monthAppointments ?? 0)} change="без отмен и неявок" trend="neutral" tone="sky" />
        </section>
        <div className="stat-strip page-section-tight"><div className="small-stat"><span>Новые клиенты</span><strong>{metrics?.newClients ?? 0}</strong></div><div className="small-stat"><span>Средний чек</span><strong className="small-stat-label">{formatCurrency(metrics?.averageCheck ?? 0)}</strong></div><div className="small-stat"><span>Неявки</span><strong>{metrics?.noShows ?? 0}</strong></div><div className="small-stat"><span>Загрузка специалистов</span><strong className="small-stat-label">{(metrics?.occupancy ?? 0).toLocaleString("ru-RU")} %</strong></div></div>

        <div className="dashboard-grid">
          <SectionCard
            title="Ближайшие записи"
            subtitle={`${upcoming.length} записей из облачной базы`}
            action={<Link href="/appointments" className="button button-ghost">Открыть календарь <ArrowRight size={14} /></Link>}
          >
            {upcoming.length === 0 ? <EmptyState title="Расписание пока пустое" description="Создайте первую запись — она появится здесь автоматически." action={<Link href="/appointments" className="button button-secondary">Добавить запись</Link>} /> : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Время</th><th>Клиент</th><th>Специалист</th><th>Статус</th><th>Сумма</th></tr></thead>
                  <tbody>{upcoming.map((appointment) => (
                    <tr key={appointment.id}>
                      <td><span className="table-time">{formatDateTime(appointment.startsAt)}</span></td>
                      <td><div className="client-cell"><Avatar initials={initials(appointment.clientName)} tone="violet" /><div><strong>{appointment.clientName}</strong><span>{appointment.serviceName ?? "Услуга не указана"}</span></div></div></td>
                      <td>{appointment.employeeName ?? "Специалист не назначен"}</td>
                      <td><StatusPill status={statusKey(appointment.status)} /></td>
                      <td><Amount value={Number(appointment.amount || 0)} /><span className="table-secondary">Оплачено {Number(appointment.paidAmount || 0).toLocaleString("ru-RU")} ₸</span></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Выручка по дням" subtitle="Последние 7 дней" className="chart-card">
            {chart.length === 0 ? <EmptyState title="График появится после первого приёма" description="Завершите запись с суммой — данные попадут в аналитику." /> : <>
              <div className="chart-summary"><strong>{formatCurrency(chart.reduce((sum, item) => sum + Number(item.amount || 0), 0))}</strong><span>по завершённым приёмам</span></div>
              <div className="chart-bars" aria-label="График выручки по дням">{chart.map((bar) => <div key={bar.day} className="chart-bar-group"><div className="chart-bar" style={{ height: `${bar.height}%` }} /><span>{new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(new Date(`${bar.day}T12:00:00`)).replace(".", "")}</span></div>)}</div>
              <div className="chart-legend"><i /> Выручка по завершённым приёмам</div>
            </>}
          </SectionCard>
        </div>

        <div className="dashboard-grid dashboard-grid-equal">
          <SectionCard title="Сводка центра" subtitle="Только фактические записи">
            <div className="summary-list">
              <div className="summary-row"><div className="summary-row-copy"><i style={{ background: "#8f80eb" }} />Клиенты в базе</div><strong>{metrics?.clients ?? 0}</strong></div>
              <div className="summary-row"><div className="summary-row-copy"><i style={{ background: "#6bb9e4" }} />Активные сотрудники</div><strong>{metrics?.activeEmployees ?? 0}</strong></div>
              <div className="summary-row"><div className="summary-row-copy"><i style={{ background: "#79c89e" }} />Записи сегодня</div><strong>{metrics?.todayAppointments ?? 0}</strong></div>
            </div>
          </SectionCard>

          <SectionCard title="Быстрые действия" subtitle="Операции, которые нужны каждый день">
            <div className="quick-actions">
              <Link href="/appointments" className="quick-action"><span className="quick-action-icon quick-mint"><CalendarPlus size={18} /></span><span><strong>Добавить запись</strong><small>{expectedRevenue ? `Ожидаемо ${formatCurrency(expectedRevenue)}` : "Создать приём клиента"}</small></span><ArrowRight size={15} /></Link>
              <Link href="/finance" className="quick-action"><span className="quick-action-icon quick-peach"><WalletCards size={18} /></span><span><strong>Добавить расход</strong><small>{metrics?.expenses ? `За месяц ${formatCurrency(metrics.expenses)}` : "Зафиксировать операцию"}</small></span><ArrowRight size={15} /></Link>
            </div>
          </SectionCard>
        </div>
      </> : null}
    </>
  );
}
