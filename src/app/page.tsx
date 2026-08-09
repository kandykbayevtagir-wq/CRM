import Link from "next/link";
import { ArrowRight, CalendarPlus, Download, Plus, WalletCards } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Amount, Avatar, Button, MetricCard, PageHeader, SectionCard, StatusPill } from "@/components/ui";
import { appointments, dashboardMetrics, employees, expenses, revenueBars } from "@/lib/demo-data";
import { formatCurrency } from "@/lib/format";

export default function DashboardPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="Понедельник, 9 августа 2026"
        title="Доброе утро, Тагир"
        description="Вот как выглядит ваш центр сегодня. Все ключевые цифры — на одном экране."
        actions={
          <>
            <Button variant="secondary"><Download size={15} /> Экспорт</Button>
            <Button><Plus size={16} /> Новая запись</Button>
          </>
        }
      />

      <section className="metrics-grid">
        {dashboardMetrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
      </section>

      <div className="dashboard-grid">
        <SectionCard
          title="Записи на сегодня"
          subtitle="12 записей · 2 филиала"
          action={<Link href="/appointments" className="button button-ghost">Открыть календарь <ArrowRight size={14} /></Link>}
        >
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Время</th><th>Клиент</th><th>Специалист</th><th>Статус</th><th>Сумма</th></tr>
              </thead>
              <tbody>
                {appointments.slice(0, 4).map((appointment) => (
                  <tr key={appointment.id}>
                    <td><span className="table-time">{appointment.time}</span></td>
                    <td>
                      <div className="client-cell">
                        <Avatar initials={appointment.client.split(" ").map((part) => part[0]).join("").slice(0, 2)} tone={appointment.id === "a-02" ? "blue" : "violet"} />
                        <div><strong>{appointment.client}</strong><span>{appointment.service}</span></div>
                      </div>
                    </td>
                    <td>{appointment.specialist}</td>
                    <td><StatusPill status={appointment.status} /></td>
                    <td><Amount value={appointment.amount} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard title="Динамика выручки" subtitle="Текущая неделя" className="chart-card" action={<span className="status-pill status-completed">+12,8%</span>}>
          <div className="chart-summary">
            <strong>642 000 ₸</strong>
            <span>к прошлой неделе</span>
          </div>
          <div className="chart-bars" aria-label="График выручки по дням">
            {revenueBars.map((bar) => <div key={bar.day} className="chart-bar-group"><div className="chart-bar" style={{ height: `${bar.value}%` }} /><span>{bar.day}</span></div>)}
          </div>
          <div className="chart-legend"><i /> Выручка по завершённым приёмам</div>
        </SectionCard>
      </div>

      <div className="dashboard-grid dashboard-grid-equal">
        <SectionCard title="Загрузка специалистов" subtitle="Август 2026" action={<Link href="/employees" className="button button-ghost">Все сотрудники <ArrowRight size={14} /></Link>}>
          <div className="insight-list">
            {employees.slice(0, 3).map((employee) => (
              <div className="insight-row" key={employee.id}>
                <Avatar initials={employee.initials} tone={employee.tone} />
                <div className="insight-copy"><strong>{employee.name}</strong><span>{employee.appointments} приёма · {employee.branch}</span></div>
                <span className="insight-value">{Math.round((employee.appointments / 100) * 100)}%</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Расходы за месяц" subtitle="По основным категориям" action={<Link href="/finance" className="button button-ghost">Все расходы <ArrowRight size={14} /></Link>}>
          <div className="summary-list">
            {[{ label: "Зарплаты", value: 1180000, width: 82, color: "#8f80eb" }, { label: "Аренда", value: 500000, width: 39, color: "#6bb9e4" }, { label: "Коммунальные", value: 145000, width: 18, color: "#79c89e" }, { label: "Расходники", value: 310000, width: 25, color: "#eda170" }].map((row) => (
              <div key={row.label}>
                <div className="summary-row"><div className="summary-row-copy"><i style={{ background: row.color }} />{row.label}</div><strong>{formatCurrency(row.value)}</strong></div>
                <div className="progress-track"><div className="progress-value" style={{ width: `${row.width}%`, background: row.color }} /></div>
              </div>
            ))}
          </div>
          <div className="summary-total"><span>Всего расходов</span><strong>{formatCurrency(2135000)}</strong></div>
        </SectionCard>
      </div>

      <div className="dashboard-grid dashboard-grid-equal">
        <SectionCard title="Ближайшие платежи" subtitle="Не забудьте оплатить вовремя">
          <div className="summary-list">
            {expenses.filter((expense) => expense.status === "planned").map((expense) => (
              <div key={expense.id} className="summary-row">
                <div className="summary-row-copy"><i style={{ background: expense.category === "Коммунальные" ? "#79c89e" : "#6bb9e4" }} /><span>{expense.title}</span></div>
                <strong>{formatCurrency(expense.amount)}</strong>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Быстрые действия" subtitle="Часто используемые операции">
          <div className="quick-actions">
            <Link href="/appointments" className="quick-action"><span className="quick-action-icon quick-mint"><CalendarPlus size={18} /></span><span><strong>Добавить запись</strong><small>Создать приём клиента</small></span><ArrowRight size={15} /></Link>
            <Link href="/finance" className="quick-action"><span className="quick-action-icon quick-peach"><WalletCards size={18} /></span><span><strong>Добавить расход</strong><small>Зафиксировать платёж</small></span><ArrowRight size={15} /></Link>
          </div>
        </SectionCard>
      </div>
    </AppShell>
  );
}
