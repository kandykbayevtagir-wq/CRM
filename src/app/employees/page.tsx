import { Download, Plus, UserRoundPlus } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Amount, Avatar, Button, FilterSelect, PageHeader, SectionCard } from "@/components/ui";
import { employees } from "@/lib/demo-data";
import { formatCurrency } from "@/lib/format";

export default function EmployeesPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="Управление"
        title="Сотрудники"
        description="Команда, условия начисления и предварительный расчёт зарплаты за текущий месяц."
        actions={<><Button variant="secondary"><Download size={15} /> Экспорт</Button><Button><UserRoundPlus size={16} /> Добавить сотрудника</Button></>}
      />

      <div className="stat-strip">
        <div className="small-stat"><span>Активные сотрудники</span><strong>4</strong></div>
        <div className="small-stat"><span>Фонд зарплаты</span><strong>1,18 млн ₸</strong></div>
        <div className="small-stat"><span>Средняя загрузка</span><strong>78%</strong></div>
      </div>

      <div className="filter-bar">
        <FilterSelect label="Филиал" value="Все филиалы" />
        <FilterSelect label="Роль" value="Все роли" />
        <div className="filter-spacer" />
        <Button variant="secondary"><Plus size={15} /> Настроить период</Button>
      </div>

      <section className="cards-grid page-section">
        {employees.map((employee) => (
          <article className="employee-card" key={employee.id}>
            <div className="employee-card-top">
              <div className="employee-card-name"><Avatar initials={employee.initials} tone={employee.tone} /><div><strong>{employee.name}</strong><span>{employee.role} · {employee.branch}</span></div></div>
              <button className="more-button" aria-label={`Действия для ${employee.name}`}>···</button>
            </div>
            <div className="employee-card-stats">
              <div className="employee-card-stat"><span>Выручка</span><strong>{employee.revenue ? formatCurrency(employee.revenue) : "—"}</strong></div>
              <div className="employee-card-stat"><span>Приёмов</span><strong>{employee.appointments || "—"}</strong></div>
              <div className="employee-card-stat"><span>Зарплата</span><strong>{formatCurrency(employee.payroll)}</strong></div>
              <div className="employee-card-stat"><span>Процент</span><strong>{employee.percent ? `${employee.percent}%` : "Фикс"}</strong></div>
            </div>
          </article>
        ))}
      </section>

      <SectionCard title="Предварительный расчёт зарплаты" subtitle="Август 2026 · период ещё не закрыт" action={<Button variant="secondary">Открыть расчёт</Button>}>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Сотрудник</th><th>Фиксированная часть</th><th>Процент с выручки</th><th>Бонусы / удержания</th><th>Итого</th></tr></thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.id}>
                  <td><div className="employee-cell"><Avatar initials={employee.initials} tone={employee.tone} /><div><strong>{employee.name}</strong><span>{employee.role}</span></div></div></td>
                  <td>{employee.role === "Администратор" ? <Amount value={employee.payroll} /> : <span>0 ₸</span>}</td>
                  <td>{employee.percent ? <Amount value={Math.round(employee.revenue * employee.percent / 100)} /> : <span>—</span>}</td>
                  <td><span className="amount-muted">+20 000 ₸</span></td>
                  <td><Amount value={employee.payroll} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </AppShell>
  );
}
