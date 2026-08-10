"use client";

import { BarChart3, Download, FileSpreadsheet } from "lucide-react";

import { AuthHint, EmptyState, ErrorState, isAuthError, LoadingState } from "@/components/data-state";
import { Amount, Button, PageHeader, SectionCard } from "@/components/ui";
import type { DashboardResponse, EmployeeRecord } from "@/lib/crm-types";
import { formatCurrency, formatDate } from "@/lib/format";
import { useApi } from "@/lib/use-api";

type EmployeeResponse = { ok: true; items: EmployeeRecord[] };

export function ReportsView() {
  const { data: dashboard, loading, error, reload } = useApi<DashboardResponse>("/api/dashboard");
  const { data: employees, error: employeesError, reload: reloadEmployees } = useApi<EmployeeResponse>("/api/employees");
  const metrics = dashboard?.metrics ?? { clients: 0, todayAppointments: 0, monthAppointments: 0, revenue: 0, expenses: 0, payroll: 0, activeEmployees: 0 };
  const profit = (metrics?.revenue ?? 0) - (metrics?.expenses ?? 0) - (metrics?.payroll ?? 0);
  const combinedError = error ?? employeesError;
  const period = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date());

  return (
    <>
      <PageHeader eyebrow="Управление" title="Отчёты" description="Сводный учёт по выручке, сотрудникам и операционному результату на основе данных D1." actions={<><Button variant="secondary" onClick={() => window.print()}><Download size={15} /> Печать</Button><Button variant="secondary" onClick={() => window.print()}><FileSpreadsheet size={15} /> Сохранить PDF</Button></>} />

      {loading && !dashboard ? <LoadingState /> : null}
      {combinedError && isAuthError(combinedError) ? <AuthHint /> : null}
      {combinedError && !isAuthError(combinedError) ? <ErrorState message={combinedError} onRetry={() => { void Promise.all([reload(), reloadEmployees()]); }} /> : null}

      {dashboard && employees ? <>
        <div className="report-period-banner"><BarChart3 size={19} /><div><strong>Сводный отчёт за {period}</strong><span>Период рассчитывается по фактическим операциям и завершённым приёмам.</span></div></div>
        <div className="dashboard-grid dashboard-grid-equal">
          <SectionCard title="Операционный результат" subtitle="После расходов и начислений зарплат">
            <div className="chart-summary"><div><strong>{formatCurrency(profit)}</strong><span>текущий результат</span></div><BarChart3 size={32} color="#6f5be7" strokeWidth={1.5} /></div>
            <div className="summary-list"><div><div className="summary-row"><div className="summary-row-copy"><i style={{ background: "#36ad7b" }} />Выручка</div><strong>{formatCurrency(metrics.revenue)}</strong></div><div className="progress-track"><div className="progress-value" style={{ width: "100%", background: "#36ad7b" }} /></div></div><div><div className="summary-row"><div className="summary-row-copy"><i style={{ background: "#eda170" }} />Расходы и зарплаты</div><strong>{formatCurrency(metrics.expenses + metrics.payroll)}</strong></div><div className="progress-track"><div className="progress-value" style={{ width: `${metrics.revenue ? Math.min(100, Math.round(((metrics.expenses + metrics.payroll) / metrics.revenue) * 100)) : 0}%`, background: "#eda170" }} /></div></div></div>
          </SectionCard>
          <SectionCard title="Ключевые показатели" subtitle="Без сравнений с несуществующими периодами">
            <div className="summary-list"><div className="summary-row"><div className="summary-row-copy">Клиенты в базе</div><span className="report-value"><strong>{metrics.clients}</strong><small>актуально</small></span></div><div className="summary-row"><div className="summary-row-copy">Записи за месяц</div><span className="report-value"><strong>{metrics.monthAppointments}</strong><small>без отмен</small></span></div><div className="summary-row"><div className="summary-row-copy">Активные сотрудники</div><span className="report-value"><strong>{metrics.activeEmployees}</strong><small>в команде</small></span></div><div className="summary-row"><div className="summary-row-copy">Ожидаемая прибыль</div><span className="report-value"><strong>{formatCurrency(profit)}</strong><small>после зарплат</small></span></div></div>
          </SectionCard>
        </div>

        <SectionCard title="Выручка и зарплата специалистов" subtitle={`Актуально на ${formatDate(new Date().toISOString())}`}>
          {employees.items.length === 0 ? <EmptyState title="Нет сотрудников для отчёта" description="Добавьте команду и назначьте её на записи." /> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Специалист</th><th>Приёмов</th><th>Выручка</th><th>Процент</th><th>Прогноз зарплаты</th></tr></thead><tbody>{employees.items.map((employee) => { const percentAmount = Number(employee.revenue || 0) * Number(employee.revenuePercent || 0) / 100; const payroll = Number(employee.fixedSalary || 0) + percentAmount; return <tr key={employee.id}><td><div className="employee-cell"><span className="avatar avatar-violet">{employee.fullName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><div><strong>{employee.fullName}</strong><span>{employee.branchName ?? "Без филиала"}</span></div></div></td><td>{Number(employee.appointments || 0)}</td><td><Amount value={Number(employee.revenue || 0)} /></td><td>{Number(employee.revenuePercent || 0)}%</td><td><Amount value={payroll} /></td></tr>; })}</tbody></table></div>}
        </SectionCard>
      </> : null}
    </>
  );
}
