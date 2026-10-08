"use client";

import { ResponsiveTable } from "@/components/responsive-table";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Download, Plus, Printer, Search, UserRoundPlus } from "lucide-react";

import { apiFetch, dispatchCrmEvent } from "@/lib/api-client";
import { AuthHint, EmptyState, ErrorState, FormField, InlineError, isAuthError, LoadingState, Modal } from "@/components/data-state";
import { Amount, Avatar, Button, PageHeader, SectionCard, StatusPill } from "@/components/ui";
import type { ClientsResponse } from "@/lib/crm-types";
import { formatDateTime, initials, insideTelegram, plural } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useCan } from "@/lib/current-user";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { PhoneInput } from "@/components/phone-input";

const tones = ["violet", "blue", "peach"];

export function ClientsView() {
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("active");
  const canCreate = useCan("clients.write");
  const canExport = useCan("exports.read");
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const searchParams = new URLSearchParams({ page: String(page), pageSize: "25", status });
  if (debouncedQuery) searchParams.set("q", debouncedQuery);
  const path = `/api/clients?${searchParams.toString()}`;
  const { data, loading, error, reload } = useApi<ClientsResponse>(path);
  const items = data?.items ?? [];
  const restricted = Boolean(data?.restricted);
  const filtered = Boolean(debouncedQuery) || status !== "active";
  const canPrint = typeof window !== "undefined" && !insideTelegram();

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError(null);
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await apiFetch("/api/clients", { method: "POST", body: values });
      setModalOpen(false);
      dispatchCrmEvent("crm:data-changed");
      setPage(1);
      await reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Не удалось добавить клиента");
    } finally {
      setSaving(false);
    }
  }

  function openCreate() {
    setFormError(null);
    setModalOpen(true);
  }

  return (
    <>
      <PageHeader
        eyebrow="Рабочий стол"
        title="Клиенты"
        description={restricted ? "База клиентов с историей посещений. Суммы оплат и внутренние заметки доступны администраторам." : "Единая база клиентов с историей посещений и фактическими оплатами."}
        actions={<>
          {canExport ? <Button variant="secondary" onClick={() => { window.location.href = "/api/export?type=clients"; }}><Download size={15} /> CSV клиентов</Button> : null}
          {canPrint ? <Button variant="secondary" onClick={() => window.print()}><Printer size={15} /> Печать</Button> : null}
          {canCreate ? <Button onClick={openCreate}><UserRoundPlus size={16} /> Новый клиент</Button> : null}
        </>}
      />

      {loading && !data ? <LoadingState /> : null}
      {error && isAuthError(error) ? <AuthHint /> : null}
      {error && !isAuthError(error) ? <ErrorState message={error} onRetry={reload} /> : null}

      {data ? <>
        <div className="stat-strip">
          <div className="small-stat"><span>{filtered ? "Найдено" : "Клиентов в базе"}</span><strong>{data.total}</strong></div>
          <div className="small-stat"><span>Показано в списке</span><strong>{items.length}</strong></div>
          <div className="small-stat"><span>Страница</span><strong>{data.page} из {Math.max(1, data.pages)}</strong></div>
        </div>

        <div className="filter-bar">
          <label className="filter-select search-input"><span>Поиск клиента</span><span className="search-input-control"><Search size={15} aria-hidden="true" /><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Имя или телефон" maxLength={100} /></span></label>
          <label className="filter-select"><span>Статус</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="active">Активные</option><option value="archived">Архив</option><option value="all">Все</option></select></label>
          <div className="filter-spacer" />
          <span className="table-secondary" aria-live="polite">{debouncedQuery ? `Результаты для «${debouncedQuery}»: ${plural(data.total, ["клиент", "клиента", "клиентов"])}` : "Все клиенты"}</span>
        </div>

        <SectionCard title="База клиентов" subtitle="Изменения сохраняются сразу после операции">
          {items.length === 0 ? (
            filtered
              ? <EmptyState title="Ничего не найдено" description={debouncedQuery ? `По запросу «${debouncedQuery}» клиентов нет. Проверьте написание или сбросьте фильтр.` : "В этом статусе клиентов нет."} action={<Button variant="secondary" onClick={() => { setQuery(""); setStatus("active"); setPage(1); }}>Сбросить фильтры</Button>} />
              : <EmptyState title="Клиентов пока нет" description="Добавьте первого клиента, чтобы начать вести историю приёмов." action={canCreate ? <Button onClick={openCreate}><Plus size={15} /> Добавить клиента</Button> : undefined} />
          ) : (
            <div className="table-wrap">
              <ResponsiveTable className="data-table">
                <thead><tr><th>Клиент</th><th>Последний визит</th><th>Посещения</th>{restricted ? null : <th>Оплаты</th>}<th>Статус</th></tr></thead>
                <tbody>{items.map((client, index) => (
                  <tr key={client.id}>
                    <td><Link href={`/clients/${client.id}`} className="client-cell"><Avatar initials={initials(client.fullName)} tone={tones[index % tones.length]} /><div><strong>{client.fullName}</strong><span>{client.phone}{client.email ? ` · ${client.email}` : ""}</span></div></Link></td>
                    <td>{formatDateTime(client.lastVisit)}</td>
                    <td>{Number(client.visits || 0)}</td>
                    {restricted ? null : <td><Amount value={Number(client.total || 0)} /></td>}
                    <td><StatusPill status={client.status.toLowerCase()} /></td>
                  </tr>
                ))}</tbody>
              </ResponsiveTable>
            </div>
          )}
          {data.pages > 1 ? <nav className="pagination-bar" aria-label="Страницы списка клиентов"><Button variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Назад</Button><span>Страница {data.page} из {data.pages}</span><Button variant="secondary" disabled={page >= data.pages || loading} onClick={() => setPage((value) => Math.min(data.pages, value + 1))}>Далее</Button></nav> : null}
        </SectionCard>
      </> : null}

      {modalOpen ? <Modal title="Добавить клиента" onClose={() => setModalOpen(false)} busy={saving} footer={<><Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>Отмена</Button><Button type="submit" form="client-form" loading={saving}>{saving ? "Сохраняем…" : "Сохранить клиента"}</Button></>}>
        <form id="client-form" className="form-grid" onSubmit={createClient}>
          <FormField label="Имя и фамилия"><input name="fullName" required maxLength={200} placeholder="Например, Анна Иванова" autoFocus autoComplete="off" /></FormField>
          <FormField label="Телефон"><PhoneInput required placeholder="+7 700 123 45 67" enterKeyHint="next" /></FormField>
          <FormField label="Email"><input name="email" type="email" maxLength={200} placeholder="client@example.com" /></FormField>
          <FormField label="Заметка" className="form-field-wide"><textarea name="notes" maxLength={2000} placeholder="Важная информация о клиенте" rows={3} /></FormField>
          {formError ? <div className="form-field-wide"><InlineError>{formError}</InlineError></div> : null}
        </form>
      </Modal> : null}
    </>
  );
}
