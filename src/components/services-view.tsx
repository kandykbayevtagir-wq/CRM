"use client";

import { FormEvent, useState } from "react";
import { Archive, Clock3, Edit3, Plus, Sparkles } from "lucide-react";

import { apiFetch, dispatchCrmEvent } from "@/lib/api-client";
import { AuthHint, ConfirmDialog, EmptyState, ErrorState, FormField, InlineError, isAuthError, LoadingState, Modal } from "@/components/data-state";
import { Amount, Button, PageHeader, SectionCard } from "@/components/ui";
import type { ServiceRecord, ServicesResponse } from "@/lib/crm-types";
import { plural } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useCan } from "@/lib/current-user";

function ServiceForm({ service, costVisible, onClose, onSaved }: { service?: ServiceRecord; costVisible: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
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

  return <Modal title={service ? "Изменить услугу" : "Новая услуга"} onClose={onClose} busy={saving} footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Отмена</Button><Button type="submit" form="service-form" loading={saving}>{saving ? "Сохраняем…" : "Сохранить"}</Button></>}>
    <form id="service-form" className="form-grid" onSubmit={submit}>
      <FormField label="Название" className="form-field-wide"><input name="name" required maxLength={200} defaultValue={service?.name ?? ""} placeholder="Обработка стопы" autoFocus /></FormField>
      <FormField label="Категория"><input name="category" maxLength={100} defaultValue={service?.category ?? "Подология"} placeholder="Подология" /></FormField>
      <FormField label="Цена, ₸"><input name="price" type="number" min={0} step="100" inputMode="numeric" required defaultValue={service?.price ?? 0} /></FormField>
      {costVisible ? <FormField label="Себестоимость, ₸" hint="Расходники и материалы на одну процедуру. Используется в отчёте о прибыли."><input name="cost" type="number" min={0} step="100" inputMode="numeric" defaultValue={service?.cost ?? 0} /></FormField> : null}
      <FormField label="Длительность, минут"><input name="durationMinutes" type="number" min={15} max={720} step={15} inputMode="numeric" required defaultValue={service?.durationMinutes ?? 60} /></FormField>
      {service ? <FormField label="Статус"><select name="isActive" defaultValue={String(service.isActive)}><option value="1">Активна</option><option value="0">В архиве</option></select></FormField> : null}
      {error ? <div className="form-field-wide"><InlineError>{error}</InlineError></div> : null}
    </form>
  </Modal>;
}

export function ServicesView() {
  const { data, loading, error, reload } = useApi<ServicesResponse>("/api/services");
  const canWrite = useCan("services.write");
  const [modal, setModal] = useState<"create" | ServiceRecord | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ServiceRecord | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function archive() {
    if (!archiveTarget || archiving) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      await apiFetch(`/api/services/${archiveTarget.id}`, { method: "DELETE" });
      dispatchCrmEvent("crm:data-changed");
      setNotice(`Услуга «${archiveTarget.name}» перенесена в архив. Клиенты больше не видят её в онлайн-записи.`);
      setArchiveTarget(null);
      await reload();
    } catch (cause) {
      setArchiveError(cause instanceof Error ? cause.message : "Не удалось архивировать услугу");
    } finally {
      setArchiving(false);
    }
  }

  if (loading && !data) return <LoadingState />;
  if (error && isAuthError(error)) return <AuthHint />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  const items = data?.items ?? [];
  const costVisible = data?.costVisible !== false;
  const active = items.filter((service) => service.isActive);
  const archived = items.filter((service) => !service.isActive);
  const averageDuration = active.length ? Math.round(active.reduce((sum, service) => sum + service.durationMinutes, 0) / active.length) : 0;

  return <>
    <PageHeader eyebrow="Управление" title="Каталог услуг" description="Цены и длительность напрямую влияют на доступные окна для клиентов." actions={canWrite ? <Button onClick={() => setModal("create")}><Plus size={15} /> Добавить услугу</Button> : undefined} />
    <div className="stat-strip"><div className="small-stat"><span>Активных услуг</span><strong>{active.length}</strong></div><div className="small-stat"><span>Средняя длительность</span><strong>{averageDuration} мин</strong></div><div className="small-stat"><span>В архиве</span><strong>{archived.length}</strong></div></div>
    {notice ? <p className="notice notice-success" role="status">{notice}</p> : null}
    <SectionCard title="Все услуги" subtitle={canWrite ? "Клиенты видят только активные позиции" : "Клиенты видят только активные позиции · изменения вносит владелец"} action={canWrite ? <Button variant="secondary" onClick={() => setModal("create")}><Plus size={14} /> Добавить</Button> : undefined}>
      {items.length === 0 ? <EmptyState title="Каталог пока пуст" description="Добавьте первую услугу, чтобы открыть онлайн-запись клиентам." action={canWrite ? <Button onClick={() => setModal("create")}><Plus size={15} /> Создать услугу</Button> : undefined} /> : <div className="service-list">{items.map((service) => (
        <article className={`service-row ${service.isActive ? "" : "service-row-archived"}`} key={service.id}>
          <span className="service-icon"><Sparkles size={17} /></span>
          <div className="service-copy"><strong>{service.name}</strong><small>{service.category} · <Clock3 size={11} aria-hidden="true" /> {plural(service.durationMinutes, ["минута", "минуты", "минут"])}{costVisible ? ` · себестоимость ${Number(service.cost || 0).toLocaleString("ru-RU")} ₸` : ""}</small></div>
          <Amount value={Number(service.price || 0)} />
          <span className={`status-pill ${service.isActive ? "status-active" : "status-inactive"}`}>{service.isActive ? "Активна" : "Архив"}</span>
          {canWrite ? <div className="service-actions"><button type="button" className="inline-action" onClick={() => setModal(service)} aria-label={`Изменить ${service.name}`}><Edit3 size={13} /></button>{service.isActive ? <button type="button" className="inline-action danger-action" onClick={() => { setArchiveError(null); setArchiveTarget(service); }} aria-label={`Архивировать ${service.name}`}><Archive size={13} /></button> : null}</div> : null}
        </article>
      ))}</div>}
    </SectionCard>
    {modal ? <ServiceForm service={modal === "create" ? undefined : modal} costVisible={costVisible} onClose={() => setModal(null)} onSaved={reload} /> : null}
    {archiveTarget ? <ConfirmDialog title="Убрать услугу в архив?" description={`«${archiveTarget.name}» исчезнет из онлайн-записи и из выбора при создании записи. Уже созданные записи и история оплат сохранятся, услугу можно вернуть позже.`} confirmLabel="В архив" danger pending={archiving} error={archiveError} onConfirm={() => void archive()} onClose={() => { if (!archiving) setArchiveTarget(null); }} /> : null}
  </>;
}
