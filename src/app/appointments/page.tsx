import { CalendarDays, Download, Plus, Search } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Amount, Avatar, Button, FilterSelect, PageHeader, SectionCard, StatusPill } from "@/components/ui";
import { appointments } from "@/lib/demo-data";

export default function AppointmentsPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="Рабочий стол"
        title="Записи"
        description="Календарь приёмов, статусы клиентов и загрузка специалистов по филиалам."
        actions={<><Button variant="secondary"><Download size={15} /> Экспорт</Button><Button><Plus size={16} /> Новая запись</Button></>}
      />

      <div className="stat-strip">
        <div className="small-stat"><span>Сегодня</span><strong>12 записей</strong></div>
        <div className="small-stat"><span>Завершено</span><strong>4 приёма</strong></div>
        <div className="small-stat"><span>Ожидаемая выручка</span><strong>216 000 ₸</strong></div>
      </div>

      <div className="filter-bar">
        <FilterSelect label="Дата" value="9 августа 2026" />
        <FilterSelect label="Филиал" value="Все филиалы" />
        <FilterSelect label="Специалист" value="Все специалисты" />
        <FilterSelect label="Статус" value="Все статусы" />
        <div className="filter-spacer" />
        <label className="filter-select search-input"><span>Поиск</span><Search size={15} /><input placeholder="Имя или телефон" /></label>
      </div>

      <SectionCard title="Расписание на сегодня" subtitle="Понедельник, 9 августа · 2 филиала" action={<button className="icon-button" aria-label="Открыть календарь"><CalendarDays size={18} /></button>}>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Время</th><th>Клиент</th><th>Специалист</th><th>Филиал</th><th>Статус</th><th>Сумма</th></tr></thead>
            <tbody>
              {appointments.map((appointment) => (
                <tr key={appointment.id}>
                  <td><span className="table-time">{appointment.time}</span></td>
                  <td><div className="client-cell"><Avatar initials={appointment.client.split(" ").map((part) => part[0]).join("").slice(0, 2)} tone={appointment.id === "a-03" ? "peach" : "violet"} /><div><strong>{appointment.client}</strong><span>{appointment.phone}</span></div></div></td>
                  <td>{appointment.specialist}<span className="table-secondary">{appointment.service}</span></td>
                  <td>{appointment.branch.replace("Астана · ", "")}</td>
                  <td><StatusPill status={appointment.status} /></td>
                  <td><Amount value={appointment.amount} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </AppShell>
  );
}
