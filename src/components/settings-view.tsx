"use client";

import { FormEvent, useEffect, useState } from "react";
import { BellRing, Building2, Cloud, LockKeyhole, Plus, SlidersHorizontal, UsersRound } from "lucide-react";

import { apiFetch, dispatchCrmEvent } from "@/lib/api-client";
import { AuthHint, EmptyState, ErrorState, FormField, isAuthError, LoadingState, Modal } from "@/components/data-state";
import { Button, PageHeader, SectionCard } from "@/components/ui";
import type { SettingsResponse } from "@/lib/crm-types";
import { useApi } from "@/lib/use-api";

export function SettingsView() {
  const [brandName, setBrandName] = useState("");
  const [saving, setSaving] = useState(false);
  const [branchModalOpen, setBranchModalOpen] = useState(false);
  const [branchSaving, setBranchSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { data, loading, error, reload } = useApi<SettingsResponse>("/api/settings");

  useEffect(() => {
    if (data?.settings?.brandName) setBrandName(data.settings.brandName);
  }, [data?.settings?.brandName]);

  async function saveSettings() {
    setSaving(true);
    setFormError(null);
    try {
      await apiFetch("/api/settings", { method: "PATCH", body: { brandName } });
      dispatchCrmEvent("crm:data-changed");
      await reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Не удалось сохранить настройки");
    } finally {
      setSaving(false);
    }
  }

  async function createBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBranchSaving(true);
    setFormError(null);
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await apiFetch("/api/branches", { method: "POST", body: values });
      setBranchModalOpen(false);
      dispatchCrmEvent("crm:data-changed");
      await reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Не удалось добавить филиал");
    } finally {
      setBranchSaving(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Управление" title="Настройки" description="Название центра, филиалы, роли и правила работы облачной CRM." actions={<Button onClick={() => void saveSettings()} disabled={saving}>{saving ? "Сохраняем…" : "Сохранить изменения"}</Button>} />

      {loading && !data ? <LoadingState /> : null}
      {error && isAuthError(error) ? <AuthHint /> : null}
      {error && !isAuthError(error) ? <ErrorState message={error} onRetry={reload} /> : null}

      {data ? <div className="settings-grid">
        <SectionCard title="Профиль центра" subtitle="Данные организации хранятся в Cloudflare D1">
          <div className="settings-icon-heading"><span className="settings-big-icon settings-purple"><Building2 size={20} /></span><div><strong>{data.settings.brandName}</strong><span>Подологический центр · {data.branches.length} филиалов</span></div></div>
          <div className="settings-form"><FormField label="Название организации"><input value={brandName} onChange={(event) => setBrandName(event.target.value)} /></FormField></div>
          <div className="settings-list"><div className="settings-item"><div><strong>Валюта</strong><span>Используется в расчётах</span></div><span className="settings-value">{data.settings.currency} · Тенге</span></div><div className="settings-item"><div><strong>Часовой пояс</strong><span>Для календаря и уведомлений</span></div><span className="settings-value">{data.settings.timezone}</span></div></div>
          {formError ? <p className="form-error">{formError}</p> : null}
        </SectionCard>

        <SectionCard title="Филиалы" subtitle="Используются в записях, сотрудниках и расходах" action={<Button variant="secondary" onClick={() => { setFormError(null); setBranchModalOpen(true); }}><Plus size={14} /> Добавить</Button>}>
          {data.branches.length === 0 ? <EmptyState title="Филиалов пока нет" description="Добавьте первый филиал, чтобы распределять записи и операции." action={<Button onClick={() => setBranchModalOpen(true)}><Plus size={15} /> Добавить филиал</Button>} /> : <div className="settings-list">{data.branches.map((branch) => <div className="settings-item" key={branch.id}><div><strong>{branch.name}</strong><span>{branch.address || "Адрес не указан"}{branch.phone ? ` · ${branch.phone}` : ""}</span></div><span className={`status-pill ${branch.isActive ? "status-active" : "status-inactive"}`}>{branch.isActive ? "Активен" : "Архив"}</span></div>)}</div>}
        </SectionCard>

        <SectionCard title="Облачная синхронизация" subtitle="Единый источник данных для команды"><div className="cloud-status"><span className="cloud-status-dot" /><div><strong>Cloudflare D1 подключён</strong><span>Изменения доступны на всех устройствах после авторизации в Telegram.</span></div><Cloud size={20} color="#36ad7b" /></div><div className="settings-list cloud-details"><div className="settings-item"><div><strong>Резервная инфраструктура</strong><span>Cloudflare Pages + D1</span></div><span className="status-pill status-active">Работает</span></div><div className="settings-item"><div><strong>Журнал изменений</strong><span>Фиксирует операции сотрудников</span></div><span className="status-pill status-active">Включён</span></div></div></SectionCard>

        <SectionCard title="Роли и доступы" subtitle="Базовые роли для сотрудников CRM"><div className="settings-list"><div className="settings-item"><div><strong>Владелец</strong><span>Полный доступ к центру и настройкам</span></div><UsersRound size={18} color="#6f5be7" /></div><div className="settings-item"><div><strong>Администратор</strong><span>Записи, клиенты и оплаты</span></div><SlidersHorizontal size={18} color="#6f5be7" /></div><div className="settings-item"><div><strong>Специалист</strong><span>Свои записи и рабочие данные</span></div><LockKeyhole size={18} color="#6f5be7" /></div><div className="settings-item"><div><strong>Бухгалтер</strong><span>Финансы и отчёты</span></div><BellRing size={18} color="#6f5be7" /></div></div></SectionCard>
      </div> : null}

      {branchModalOpen ? <Modal title="Добавить филиал" onClose={() => setBranchModalOpen(false)} footer={<><Button variant="secondary" onClick={() => setBranchModalOpen(false)}>Отмена</Button><button className="button button-primary" type="submit" form="branch-form" disabled={branchSaving}>{branchSaving ? "Сохраняем…" : "Сохранить филиал"}</button></>}>
        <form id="branch-form" className="form-grid" onSubmit={createBranch}><FormField label="Название"><input name="name" required placeholder="Например, Центральный филиал" autoFocus /></FormField><FormField label="Телефон"><input name="phone" placeholder="+7 700 000 00 00" /></FormField><FormField label="Адрес" className="form-field-wide"><input name="address" placeholder="Адрес филиала" /></FormField>{formError ? <p className="form-error form-field-wide">{formError}</p> : null}</form>
      </Modal> : null}
    </>
  );
}
