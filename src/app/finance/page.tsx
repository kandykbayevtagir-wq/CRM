import { ArrowDownRight, ArrowUpRight, Download, Plus, ReceiptText } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Amount, Button, FilterSelect, PageHeader, SectionCard, StatusPill } from "@/components/ui";
import { expenses } from "@/lib/demo-data";
import { formatCurrency } from "@/lib/format";

export default function FinancePage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="Управление"
        title="Финансы"
        description="Доходы, расходы, аренда и коммунальные платежи с фильтрами по филиалам."
        actions={<><Button variant="secondary"><Download size={15} /> Экспорт отчёта</Button><Button><Plus size={16} /> Добавить операцию</Button></>}
      />

      <div className="metrics-grid">
        <div className="metric-card metric-mint"><div className="metric-card-top"><span>Доходы</span><ArrowUpRight size={16} /></div><strong>4,2 млн ₸</strong><div className="metric-change metric-change-up">+12,8% <span className="metric-period">к прошлому месяцу</span></div></div>
        <div className="metric-card metric-peach"><div className="metric-card-top"><span>Расходы</span><ArrowDownRight size={16} /></div><strong>2,4 млн ₸</strong><div className="metric-change metric-change-down">+6,2% <span className="metric-period">к прошлому месяцу</span></div></div>
        <div className="metric-card metric-lavender"><div className="metric-card-top"><span>Прибыль</span><ArrowUpRight size={16} /></div><strong>1,8 млн ₸</strong><div className="metric-change metric-change-up">+8,4% <span className="metric-period">к прошлому месяцу</span></div></div>
        <div className="metric-card metric-sky"><div className="metric-card-top"><span>Рентабельность</span><ReceiptText size={16} /></div><strong>42,9%</strong><div className="metric-change metric-change-up">+1,7 п.п. <span className="metric-period">к прошлому месяцу</span></div></div>
      </div>

      <div className="filter-bar">
        <FilterSelect label="Период" value="Август 2026" />
        <FilterSelect label="Филиал" value="Все филиалы" />
        <FilterSelect label="Тип операции" value="Все операции" />
        <div className="filter-spacer" />
        <Button variant="secondary"><Plus size={15} /> Категория расхода</Button>
      </div>

      <SectionCard title="Операции за август" subtitle="Все доходы и расходы в одном журнале" action={<StatusPill status="paid" />}>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Операция</th><th>Категория</th><th>Филиал</th><th>Дата</th><th>Статус</th><th>Сумма</th></tr></thead>
            <tbody>
              {expenses.map((expense) => (
                <tr key={expense.id}>
                  <td><strong>{expense.title}</strong></td>
                  <td>{expense.category}</td>
                  <td>{expense.branch}</td>
                  <td>{expense.date}</td>
                  <td><StatusPill status={expense.status} /></td>
                  <td><Amount value={expense.amount} /></td>
                </tr>
              ))}
              <tr><td><strong>Выручка · завершённые приёмы</strong></td><td>Доход</td><td>Все филиалы</td><td>09 августа 2026</td><td><StatusPill status="completed" /></td><td><Amount value={4200000} /></td></tr>
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="dashboard-grid dashboard-grid-equal page-section">
        <SectionCard title="Аренда по филиалам" subtitle="Август 2026">
          <div className="summary-list">
            {[{ name: "Сарыарка", amount: 310000, state: "Оплачено" }, { name: "Есиль", amount: 190000, state: "Оплачено" }].map((item) => <div className="summary-row" key={item.name}><div className="summary-row-copy"><i style={{ background: "#6bb9e4" }} /><span>{item.name}<small className="summary-subtext">{item.state}</small></span></div><strong>{formatCurrency(item.amount)}</strong></div>)}
          </div>
          <div className="summary-total"><span>Всего аренда</span><strong>{formatCurrency(500000)}</strong></div>
        </SectionCard>
        <SectionCard title="Коммунальные услуги" subtitle="Август 2026">
          <div className="summary-list">
            {[{ name: "Электроэнергия", amount: 68000, color: "#79c89e" }, { name: "Вода и отопление", amount: 54000, color: "#8f80eb" }, { name: "Интернет и связь", amount: 23000, color: "#eda170" }].map((item) => <div className="summary-row" key={item.name}><div className="summary-row-copy"><i style={{ background: item.color }} />{item.name}</div><strong>{formatCurrency(item.amount)}</strong></div>)}
          </div>
          <div className="summary-total"><span>Всего коммунальные</span><strong>{formatCurrency(145000)}</strong></div>
        </SectionCard>
      </div>
    </AppShell>
  );
}
