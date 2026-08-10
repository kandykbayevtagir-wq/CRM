"use client";

import { FormEvent, useState } from "react";
import { Download, Plus, UserRoundPlus } from "lucide-react";

import { apiFetch, dispatchCrmEvent } from "@/lib/api-client";
import { AuthHint, EmptyState, ErrorState, FormField, isAuthError, LoadingState, Modal } from "@/components/data-state";
import { Amount, Avatar, Button, PageHeader, SectionCard } from "@/components/ui";
import type { Branch, EmployeeRecord } from "@/lib/crm-types";
import { formatCurrency, initials } from "@/lib/format";
import { useApi } from "@/lib/use-api";

type EmployeeResponse = { ok: true; items: EmployeeRecord[] };
type BranchResponse = { ok: true; items: Branch[] };

const tones = ["violet", "blue", "peach", "mint"];

export function EmployeesView() {
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { data, loading, error, reload } = useApi<EmployeeResponse>("/api/employees");
  const { data: branches } = useApi<BranchResponse>("/api/branches");
  const items = data?.items ?? [];
  const active = items.filter((employee) => employee.isActive).length;
  const revenue = items.reduce((sum, employee) => sum + Number(employee.revenue || 0), 0);
  const forecastPayroll = items.reduce((sum, employee) => sum + Number(employee.fixedSalary || 0) + Number(employee.revenue || 0) * Number(employee.revenuePercent || 0) / 100, 0);

  async function createEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await apiFetch("/api/employees", { method: "POST", body: values });
      setModalOpen(false);
      dispatchCrmEvent("crm:data-changed");
      await reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Не удалось добавить сотрудника");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Управление"
        title="Сотрудники"
        description="Команда, условия начисления и прозрачный прогноз зарплаты на основе фактической выручки."
        actions={<><Button variant="secondary" onClick={() => window.print()}><Download size={15} /> Печать</Button><Button onClick={() => { setFormError(null); setModalOpen(true); }}><UserRoundPlus size={16} /> Добавить сотрудника</Button></>}
      />

      {loading && !data ? <LoadingState /> : null}
      {error && isAuthError(error) ? <AuthHint /> : null}
      {error && !isAuthError(error) ? <ErrorState message={error} onRetry={reload} /> : null}

      {data ? <>
        <div className="stat-strip">
          <div className="small-stat"><span>Активные сотрудники</span><strong>{active}</strong></div>
          <div className="small-stat"><span>Выручка текущего месяца</span><strong className="small-stat-label">{formatCurrency(revenue)}</strong></div>
          <div className="small-stat"><span>Прогноз зарплаты</span><strong className="small-stat-label">{formatCurrency(forecastPayroll)}</strong></div>
        </div>

        {items.length === 0 ? <SectionCard title="Команда"><EmptyState title="Сотрудников пока нет" description="Добавьте специалистов и настройте для них процент или фиксированную часть." action={<Button onClick={() => setModalOpen(true)}><Plus size={15} /> Добавить сотрудника</Button>} /></SectionCard> : <>
          <section className="cards-grid page-section">
            {items.map((employee, index) => {
              const forecast = Number(employee.fixedSalary || 0) + Number(employee.revenue || 0) * Number(employee.revenuePercent || 0) / 100;
              return <article className={`employee-card ${!employee.isActive ? "employee-card-inactive" : ""}`} key={employee.id}>
                <div className="employee-card-top"><div className="employee-card-name"><Avatar initials={initials(employee.fullName)} tone={tones[index % tones.length]} /><div><strong>{employee.fullName}</strong><span>{employee.position}{employee.branchName ? ` · ${employee.branchName}` : ""}</span></div></div><span className={`status-pill ${employee.isActive ? "status-active" : "status-inactive"}`}>{employee.isActive ? "Активен" : "Архив"}</span></div>
                <div className="employee-card-stats">
                  <div className="employee-card-stat"><span>Выручка</span><strong>{formatCurrency(Number(employee.revenue || 0))}</strong></div>
                  <div className="employee-card-stat"><span>Приёмов</span><strong>{Number(employee.appointments || 0)}</strong></div>
                  <div className="employee-card-stat"><span>Прогноз</span><strong>{formatCurrency(forecast)}</strong></div>
                  <div className="employee-card-stat"><span>Условия</span><strong>{employee.revenuePercent ? `${employee.revenuePercent}%` : formatCurrency(Number(employee.fixedSalary || 0))}</strong></div>
                </div>
              </article>;
            })}
          </section>

          <SectionCard title="Расчёт зарплаты" subtitle="Предварительный прогноз · период можно закрыть после проверки">
            <div className="table-wrap"><table className="data-table"><thead><tr><th>Сотрудник</th><th>Фиксированная часть</th><th>Процент с выручки</th><th>Приёмов</th><th>Прогноз итого</th></tr></thead><tbody>{items.map((employee, index) => {
              const percentAmount = Number(employee.revenue || 0) * Number(employee.revenuePercent || 0) / 100;
              const forecast = Number(employee.fixedSalary || 0) + percentAmount;
              return <tr key={employee.id}><td><div className="employee-cell"><Avatar initials={initials(employee.fullName)} tone={tones[index % tones.length]} /><div><strong>{employee.fullName}</strong><span>{employee.position}</span></div></div></td><td><Amount value={Number(employee.fixedSalary || 0)} muted /></td><td><Amount value={percentAmount} muted /></td><td>{Number(employee.appointments || 0)}</td><td><Amount value={forecast} /></td></tr>;
            })}</tbody></table></div>
          </SectionCard>
        </>}
      </> : null}

      {modalOpen ? <Modal title="Добавить сотрудника" onClose={() => setModalOpen(false)} footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>Отмена</Button><button className="button button-primary" type="submit" form="employee-form" disabled={saving}>{saving ? "Сохраняем…" : "Сохранить сотрудника"}</button></>}>
        <form id="employee-form" className="form-grid" onSubmit={createEmployee}>
          <FormField label="Имя и фамилия"><input name="fullName" required placeholder="Имя сотрудника" autoFocus /></FormField>
          <FormField label="Должность"><input name="position" required placeholder="Подолог" /></FormField>
          <FormField label="Телефон"><input name="phone" placeholder="+7 700 000 00 00" /></FormField>
          <FormField label="Email"><input name="email" type="email" placeholder="employee@example.com" /></FormField>
          <FormField label="Филиал"><select name="branchId" defaultValue=""><option value="">Без филиала</option>{branches?.items.filter((branch) => branch.isActive).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></FormField>
          <FormField label="Фиксированная часть, ₸"><input name="fixedSalary" type="number" min="0" step="1" placeholder="0" /></FormField>
          <FormField label="Процент с выручки"><input name="revenuePercent" type="number" min="0" max="100" step="0.1" placeholder="0" /></FormField>
          {formError ? <p className="form-error form-field-wide">{formError}</p> : null}
        </form>
      </Modal> : null}
    </>
  );
}
