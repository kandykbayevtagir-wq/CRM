"use client";

import { FormEvent, useState } from "react";
import { Archive, Clock3, Edit3, Plus, Sparkles } from "lucide-react";

import { apiFetch, dispatchCrmEvent } from "@/lib/api-client";
import { AuthHint, EmptyState, ErrorState, FormField, isAuthError, LoadingState, Modal } from "@/components/data-state";
import { Amount, Button, PageHeader, SectionCard } from "@/components/ui";
import type { ServiceRecord } from "@/lib/crm-types";
import { useApi } from "@/lib/use-api";

type ServiceResponse = { ok: true; items: ServiceRecord[] };

function ServiceForm({ service, onClose, onSaved }: { service?: ServiceRecord; onClose: () => void; onSaved: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await apiFetch(service ? `/api/services/${service.id}` : "/api/services", { method: service ? "PATCH" : "POST", body: values });
      dispatchCrmEvent("crm:data-changed");
      await onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить услугу");
    } finally {
      setSaving(false);
    }
  }

  return <Modal title={service ? "Изменить услугу" : "Новая услуга"} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Отмена</Button><button className="button button-primary" type="submit" form="service-form" disabled={saving}>{saving ? "Сохраняем…" : "Сохранить"}</button></>}>
    <form id="service-form" className="form-grid" onSubmit={submit}>
      <FormField label="Название" className="form-field-wide"><input name="name" required defaultValue={service?.name ?? ""} placeholder="Обработка стопы" autoFocus /></FormField>
      <FormField label="Категория"><input name="category" defaultValue={service?.category ?? "Подология"} placeholder="Подология" /></FormField>
      <FormField label="Цена, ₸"><input name="price" type="number" min={0} step="100" required defaultValue={service?.price ?? 0} /></FormField>
      <FormField label="Длительность, минут"><input name="durationMinutes" type="number" min={15} step={15} required defaultValue={service?.durationMinutes ?? 60} /></FormField>
      {service ? <FormField label="Статус"><select name="isActive" defaultValue={String(service.isActive)}><option value="1">Активна</option><option value="0">В архиве</option></select></FormField> : null}
      {error ? <p className="form-error form-field-wide">{error}</p> : null}
    </form>
  </Modal>;
}

export function ServicesView() {
  const { data, loading, error, reload } = useApi<ServiceResponse>("/api/services");
  const [modal, setModal] = useState<"create" | ServiceRecord | null>(null);

  async function archive(service: ServiceRecord) {
    if (!window.confirm(`Убрать услугу «${service.name}» в архив?`)) return;
    try {
      await apiFetch(`/api/services/${service.id}`, { method: "DELETE" });
      dispatchCrmEvent("crm:data-changed");
      await reload();
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : "Не удалось архивировать услугу");
    }
  }

  if (loading && !data) return <LoadingState />;
  if (error && isAuthError(error)) return <AuthHint />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  const items = data?.items ?? [];
  const active = items.filter((service) => service.isActive);
  const archived = items.filter((service) => !service.isActive);

  return <>
    <PageHeader eyebrow="Управление" title="Каталог услуг" description="Цены и длительность напрямую влияют на доступные окна для клиентов." actions={<Button onClick={() => setModal("create")}><Plus size={15} /> Добавить услугу</Button>} />
    <div className="stat-strip"><div className="small-stat"><span>Активных услуг</span><strong>{active.length}</strong></div><div className="small-stat"><span>Средняя длительность</span><strong>{active.length ? Math.round(active.reduce((sum, service) => sum + service.durationMinutes, 0) / active.length) : 0} мин</strong></div><div className="small-stat"><span>В архиве</span><strong>{archived.length}</strong></div></div>
    <SectionCard title="Все услуги" subtitle="Клиенты видят только активные позиции" action={<Button variant="secondary" onClick={() => setModal("create")}><Plus size={14} /> Добавить</Button>}>
      {items.length === 0 ? <EmptyState title="Каталог пока пуст" description="Добавьте первую услугу, чтобы открыть онлайн-запись клиентам." action={<Button onClick={() => setModal("create")}><Plus size={15} /> Создать услугу</Button>} /> : <div className="service-list">{items.map((service) => <article className={`service-row ${service.isActive ? "" : "service-row-archived"}`} key={service.id}><span className="service-icon"><Sparkles size={17} /></span><div className="service-copy"><strong>{service.name}</strong><small>{service.category} · <Clock3 size={11} /> {service.durationMinutes} минут</small></div><Amount value={Number(service.price || 0)} /><span className={`status-pill ${service.isActive ? "status-active" : "status-inactive"}`}>{service.isActive ? "Активна" : "Архив"}</span><div className="service-actions"><button className="inline-action" onClick={() => setModal(service)} aria-label={`Изменить ${service.name}`}><Edit3 size={13} /></button>{service.isActive ? <button className="inline-action danger-action" onClick={() => void archive(service)} aria-label={`Архивировать ${service.name}`}><Archive size={13} /></button> : null}</div></article>)}</div>}
    </SectionCard>
    {modal ? <ServiceForm service={modal === "create" ? undefined : modal} onClose={() => setModal(null)} onSaved={reload} /> : null}
  </>;
}
