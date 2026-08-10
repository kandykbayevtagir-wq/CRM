"use client";

import { useMemo, useState } from "react";
import { BarChart3, Download, FileSpreadsheet } from "lucide-react";
import { AuthHint, EmptyState, ErrorState, isAuthError, LoadingState } from "@/components/data-state";
import { Amount, Button, PageHeader, SectionCard } from "@/components/ui";
import type { Branch, EmployeeRecord } from "@/lib/crm-types";
import { formatCurrency, formatDate } from "@/lib/format";
import { useApi } from "@/lib/use-api";

type BranchResponse = { ok: true; items: Branch[] };
type EmployeeResponse = { ok: true; items: EmployeeRecord[] };
type ReportsResponse = {
  ok: true;
  period: { from: string; to: string };
  metrics: { revenue: number; grossRevenue: number; refunds: number; expenses: number; payroll: number; profit: number; margin: number; appointments: number; completed: number; cancelled: number; noShow: number; newClients: number; uniqueClients: number; returningClients: number; repeatVisitRate: number; averageCheck: number; occupiedMinutes: number; availableWorkingMinutes: number; occupancy: number; revenuePerHour: number };
  employeeRevenue: Array<{ employeeId: string; employeeName: string; appointments: number; revenue: number }>;
  serviceRevenue: Array<{ serviceId: string; serviceName: string; category: string; revenue: number; snapshotAmount: number; appointments: number }>;
};

function monthInputs() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function ReportsView() {
  const initial = useMemo(monthInputs, []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [branchId, setBranchId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const params = new URLSearchParams({ from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` });
  if (branchId) params.set("branchId", branchId);
  if (employeeId) params.set("employeeId", employeeId);
  const { data, loading, error, reload } = useApi<ReportsResponse>(`/api/reports?${params.toString()}`);
  const { data: branches } = useApi<BranchResponse>("/api/branches");
  const { data: employees } = useApi<EmployeeResponse>("/api/employees");
  const metrics = data?.metrics;
  const downloadCsv = () => { window.location.href = `/api/export?type=appointments&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`; };

  return <>
    <PageHeader eyebrow="Управление" title="Отчёты" description="Сводный учёт по фактическим оплатам, расходам, зарплате и загрузке за выбранный период." actions={<><Button variant="secondary" onClick={downloadCsv}><Download size={15} /> CSV записей</Button><Button variant="secondary" onClick={() => { window.location.href = `/api/export?type=payments&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`; }}><Download size={15} /> CSV оплат</Button><Button variant="secondary" onClick={() => window.print()}><FileSpreadsheet size={15} /> Печать</Button></>} />
    <div className="filter-bar report-filters"><label className="filter-select"><span>С даты</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label className="filter-select"><span>По дату</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><label className="filter-select"><span>Филиал</span><select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">Все филиалы</option>{branches?.items.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label className="filter-select"><span>Сотрудник</span><select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">Все сотрудники</option>{employees?.items.filter((employee) => employee.isActive).map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}</option>)}</select></label></div>
    {loading && !data ? <LoadingState /> : null}
    {error && isAuthError(error) ? <AuthHint /> : null}
    {error && !isAuthError(error) ? <ErrorState message={error} onRetry={reload} /> : null}
    {data && metrics ? <>
      <div className="report-period-banner"><BarChart3 size={19} /><div><strong>Сводный отчёт за {formatDate(data.period.from)}</strong><span>Период пересчитывается из базы при изменении фильтров.</span></div></div>
      <div className="metrics-grid"><div className="metric-card metric-mint"><div className="metric-card-top"><span>Чистая выручка</span></div><strong>{formatCurrency(metrics.revenue)}</strong><div className="metric-change metric-change-neutral">после возвратов</div></div><div className="metric-card metric-peach"><div className="metric-card-top"><span>Расходы</span></div><strong>{formatCurrency(metrics.expenses)}</strong><div className="metric-change metric-change-neutral">из ledger</div></div><div className="metric-card metric-lavender"><div className="metric-card-top"><span>Операционная прибыль</span></div><strong>{formatCurrency(metrics.profit)}</strong><div className="metric-change metric-change-neutral">margin {metrics.margin}%</div></div><div className="metric-card metric-sky"><div className="metric-card-top"><span>Загрузка</span></div><strong>{metrics.occupancy}%</strong><div className="metric-change metric-change-neutral">{metrics.occupiedMinutes} из {metrics.availableWorkingMinutes} мин.</div></div></div>
      <div className="dashboard-grid dashboard-grid-equal"><SectionCard title="Ключевые показатели" subtitle="Фактические данные периода"><div className="summary-list"><div className="summary-row"><span>Записей / завершено</span><strong>{metrics.appointments} / {metrics.completed}</strong></div><div className="summary-row"><span>Отмены / no-show</span><strong>{metrics.cancelled} / {metrics.noShow}</strong></div><div className="summary-row"><span>Новые клиенты</span><strong>{metrics.newClients}</strong></div><div className="summary-row"><span>Returning clients</span><strong>{metrics.returningClients} · {metrics.repeatVisitRate}%</strong></div><div className="summary-row"><span>Средний чек</span><strong>{formatCurrency(metrics.averageCheck)}</strong></div><div className="summary-row"><span>Выручка на час</span><strong>{formatCurrency(metrics.revenuePerHour)}</strong></div><div className="summary-row"><span>Зарплатный фонд</span><strong>{formatCurrency(metrics.payroll)}</strong></div></div></SectionCard><SectionCard title="Доходная структура" subtitle="Проведённые операции"><div className="summary-list"><div className="summary-row"><span>Валовые оплаты</span><strong>{formatCurrency(metrics.grossRevenue)}</strong></div><div className="summary-row"><span>Возвраты</span><strong>{formatCurrency(metrics.refunds)}</strong></div><div className="summary-row"><span>Чистая выручка</span><strong>{formatCurrency(metrics.revenue)}</strong></div><div className="summary-row"><span>Прибыль после зарплат</span><strong>{formatCurrency(metrics.profit)}</strong></div></div></SectionCard></div>
      <SectionCard title="Выручка по специалистам" subtitle="Оплаченная часть завершённых приёмов">{data.employeeRevenue.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Специалист</th><th>Завершено</th><th>Выручка</th></tr></thead><tbody>{data.employeeRevenue.map((employee) => <tr key={employee.employeeId}><td><strong>{employee.employeeName}</strong></td><td>{employee.appointments}</td><td><Amount value={Number(employee.revenue || 0)} /></td></tr>)}</tbody></table></div> : <EmptyState title="Нет данных по специалистам" description="Завершённые приёмы и оплаты появятся после проведения операций." />}</SectionCard>
      <SectionCard title="Выручка по услугам" subtitle="Оплаченная часть распределена по snapshot-стоимости услуг"><div className="table-wrap"><table className="data-table"><thead><tr><th>Услуга</th><th>Категория</th><th>Приёмов</th><th>Выручка</th><th>Snapshot</th></tr></thead><tbody>{data.serviceRevenue.map((service) => <tr key={service.serviceId}><td><strong>{service.serviceName}</strong></td><td>{service.category}</td><td>{service.appointments}</td><td><Amount value={Number(service.revenue || 0)} /></td><td><Amount value={Number(service.snapshotAmount || 0)} muted /></td></tr>)}</tbody></table></div></SectionCard>
    </> : null}
  </>;
}
