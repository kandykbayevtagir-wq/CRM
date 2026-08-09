import { Download, Plus, Search, UserRoundPlus } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Amount, Avatar, Button, FilterSelect, PageHeader, SectionCard, StatusPill } from "@/components/ui";
import { clients } from "@/lib/demo-data";

export default function ClientsPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="Рабочий стол"
        title="Клиенты"
        description="Единая база клиентов с историей посещений, оплат и заметок администратора."
        actions={<><Button variant="secondary"><Download size={15} /> Экспорт</Button><Button><UserRoundPlus size={16} /> Новый клиент</Button></>}
      />

      <div className="stat-strip">
        <div className="small-stat"><span>Всего клиентов</span><strong>1 248</strong></div>
        <div className="small-stat"><span>Новые в этом месяце</span><strong>86</strong></div>
        <div className="small-stat"><span>Повторные визиты</span><strong>72%</strong></div>
      </div>

      <div className="filter-bar">
        <label className="filter-select search-input"><span>Поиск клиента</span><Search size={15} /><input placeholder="Имя или телефон" /></label>
        <FilterSelect label="Статус" value="Все клиенты" />
        <FilterSelect label="Последний визит" value="За всё время" />
        <div className="filter-spacer" />
        <span className="table-secondary">Показано 6 из 1 248</span>
      </div>

      <SectionCard title="База клиентов" subtitle="Обновлено сегодня">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Клиент</th><th>Последний визит</th><th>Посещения</th><th>Всего оплат</th><th>Статус</th></tr></thead>
            <tbody>
              {clients.map((client, index) => (
                <tr key={client.id}>
                  <td><div className="client-cell"><Avatar initials={client.name.split(" ").map((part) => part[0]).join("").slice(0, 2)} tone={index % 3 === 0 ? "violet" : index % 3 === 1 ? "blue" : "peach"} /><div><a href="#" className="client-name-link">{client.name}</a><span>{client.phone}</span></div></div></td>
                  <td>{client.lastVisit}</td>
                  <td>{client.visits}</td>
                  <td><Amount value={client.total} /></td>
                  <td><StatusPill status={client.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </AppShell>
  );
}
