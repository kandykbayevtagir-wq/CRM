"use client";

import { FormEvent, useDeferredValue, useState } from "react";
import { Download, Plus, Search, UserRoundPlus } from "lucide-react";

import { apiFetch, dispatchCrmEvent } from "@/lib/api-client";
import { AuthHint, EmptyState, ErrorState, FormField, isAuthError, LoadingState, Modal } from "@/components/data-state";
import { Amount, Avatar, Button, PageHeader, SectionCard, StatusPill } from "@/components/ui";
import type { ClientRecord } from "@/lib/crm-types";
import { formatDateTime, initials } from "@/lib/format";
import { useApi } from "@/lib/use-api";

type ClientResponse = { ok: true; items: ClientRecord[]; total: number };

export function ClientsView() {
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);
  const path = `/api/clients${deferredQuery.trim() ? `?q=${encodeURIComponent(deferredQuery.trim())}` : ""}`;
  const { data, loading, error, reload } = useApi<ClientResponse>(path);
  const items = data?.items ?? [];

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await apiFetch("/api/clients", { method: "POST", body: values });
      setModalOpen(false);
      dispatchCrmEvent("crm:data-changed");
      await reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Не удалось добавить клиента");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Рабочий стол"
        title="Клиенты"
        description="Единая облачная база клиентов с историей посещений и фактическими оплатами."
        actions={<><Button variant="secondary" onClick={() => window.print()}><Download size={15} /> Печать</Button><Button onClick={() => { setFormError(null); setModalOpen(true); }}><UserRoundPlus size={16} /> Новый клиент</Button></>}
      />

      {loading && !data ? <LoadingState /> : null}
      {error && isAuthError(error) ? <AuthHint /> : null}
      {error && !isAuthError(error) ? <ErrorState message={error} onRetry={reload} /> : null}

      {data ? <>
        <div className="stat-strip">
          <div className="small-stat"><span>Клиентов в базе</span><strong>{data.total}</strong></div>
          <div className="small-stat"><span>Показано в списке</span><strong>{items.length}</strong></div>
          <div className="small-stat"><span>Источник данных</span><strong className="small-stat-label">Cloudflare D1</strong></div>
        </div>

        <div className="filter-bar">
          <label className="filter-select search-input"><span>Поиск клиента</span><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя или телефон" /></label>
          <div className="filter-spacer" />
          <span className="table-secondary">{deferredQuery ? `Результаты для «${deferredQuery}»` : "Все клиенты"}</span>
        </div>

        <SectionCard title="База клиентов" subtitle="Изменения сохраняются в облаке сразу после операции">
          {items.length === 0 ? <EmptyState title="Клиентов пока нет" description="Добавьте первого клиента, чтобы начать вести историю приёмов." action={<Button onClick={() => setModalOpen(true)}><Plus size={15} /> Добавить клиента</Button>} /> : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Клиент</th><th>Последний визит</th><th>Посещения</th><th>Оплаты</th><th>Статус</th></tr></thead>
                <tbody>{items.map((client, index) => (
                  <tr key={client.id}>
                    <td><div className="client-cell"><Avatar initials={initials(client.fullName)} tone={index % 3 === 0 ? "violet" : index % 3 === 1 ? "blue" : "peach"} /><div><strong>{client.fullName}</strong><span>{client.phone}{client.email ? ` · ${client.email}` : ""}</span></div></div></td>
                    <td>{formatDateTime(client.lastVisit)}</td>
                    <td>{Number(client.visits || 0)}</td>
                    <td><Amount value={Number(client.total || 0)} /></td>
                    <td><StatusPill status={client.status.toLowerCase()} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </> : null}

      {modalOpen ? <Modal title="Добавить клиента" onClose={() => setModalOpen(false)} footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>Отмена</Button><button className="button button-primary" type="submit" form="client-form" disabled={saving}>{saving ? "Сохраняем…" : "Сохранить клиента"}</button></>}>
        <form id="client-form" className="form-grid" onSubmit={createClient}>
          <FormField label="Имя и фамилия"><input name="fullName" required placeholder="Например, Анна Иванова" autoFocus /></FormField>
          <FormField label="Телефон"><input name="phone" required placeholder="+7 700 000 00 00" /></FormField>
          <FormField label="Email"><input name="email" type="email" placeholder="client@example.com" /></FormField>
          <FormField label="Заметка" className="form-field-wide"><textarea name="notes" placeholder="Важная информация о клиенте" rows={3} /></FormField>
          {formError ? <p className="form-error form-field-wide">{formError}</p> : null}
        </form>
      </Modal> : null}
    </>
  );
}
