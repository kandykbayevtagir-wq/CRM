import { BarChart3, Download, FileSpreadsheet } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Amount, Button, FilterSelect, PageHeader, SectionCard } from "@/components/ui";
import { employees } from "@/lib/demo-data";
import { formatCurrency } from "@/lib/format";

export default function ReportsPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="Управление"
        title="Отчёты"
        description="Сводный учёт по выручке, сотрудникам, клиентам и операционной прибыли."
        actions={<><Button variant="secondary"><Download size={15} /> Скачать PDF</Button><Button><FileSpreadsheet size={15} /> Экспорт Excel</Button></>}
      />

      <div className="filter-bar">
        <FilterSelect label="Период" value="Август 2026" />
        <FilterSelect label="Филиал" value="Все филиалы" />
        <FilterSelect label="Срез отчёта" value="Сводный учёт" />
      </div>

      <div className="dashboard-grid dashboard-grid-equal">
        <SectionCard title="Операционный результат" subtitle="За выбранный период">
          <div className="chart-summary"><div><strong>1 800 000 ₸</strong><span>Прибыль после расходов</span></div><BarChart3 size={32} color="#6f5be7" strokeWidth={1.5} /></div>
          <div className="summary-list">
            {[{ label: "Выручка", value: 4200000, width: 100, color: "#36ad7b" }, { label: "Расходы", value: 2400000, width: 57, color: "#eda170" }, { label: "Прибыль", value: 1800000, width: 43, color: "#6f5be7" }].map((row) => <div key={row.label}><div className="summary-row"><div className="summary-row-copy"><i style={{ background: row.color }} />{row.label}</div><strong>{formatCurrency(row.value)}</strong></div><div className="progress-track"><div className="progress-value" style={{ width: `${row.width}%`, background: row.color }} /></div></div>)}
          </div>
        </SectionCard>
        <SectionCard title="Ключевые показатели" subtitle="Изменение к прошлому месяцу">
          <div className="summary-list">
            {[{ label: "Средний чек", value: "14 685 ₸", change: "+4,2%" }, { label: "Повторные визиты", value: "72%", change: "+5,8%" }, { label: "Загрузка кабинетов", value: "78%", change: "+7,1%" }, { label: "Отмены и неявки", value: "4,8%", change: "−1,3%" }].map((row) => <div className="summary-row" key={row.label}><div className="summary-row-copy">{row.label}</div><span className="report-value"><strong>{row.value}</strong><small>{row.change}</small></span></div>)}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Выручка и зарплата специалистов" subtitle="Актуально на 9 августа 2026">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Специалист</th><th>Приёмов</th><th>Выручка</th><th>Доля</th><th>Зарплата</th></tr></thead>
            <tbody>{employees.filter((employee) => employee.revenue > 0).map((employee) => <tr key={employee.id}><td><div className="employee-cell"><span className={`avatar avatar-${employee.tone}`}>{employee.initials}</span><div><strong>{employee.name}</strong><span>{employee.branch}</span></div></div></td><td>{employee.appointments}</td><td><Amount value={employee.revenue} /></td><td>{Math.round(employee.revenue / 3620000 * 100)}%</td><td><Amount value={employee.payroll} /></td></tr>)}</tbody>
          </table>
        </div>
      </SectionCard>
    </AppShell>
  );
}
