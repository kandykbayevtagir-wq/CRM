"use client";

import { ResponsiveTable } from "@/components/responsive-table";

import { FormEvent, useState } from "react";
import { Plus, Printer, UserRoundPlus } from "lucide-react";

import { apiFetch, dispatchCrmEvent } from "@/lib/api-client";
import { AuthHint, EmptyState, ErrorState, FormField, InlineError, isAuthError, LoadingState, Modal } from "@/components/data-state";
import { Amount, Avatar, Button, PageHeader, SectionCard } from "@/components/ui";
import type { Branch, EmployeeRecord, EmployeesResponse, ServicesResponse } from "@/lib/crm-types";
import { formatCurrency, initials, insideTelegram, plural } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useCan } from "@/lib/current-user";
import { PhoneInput } from "@/components/phone-input";

type BranchResponse = { ok: true; items: Branch[] };

const tones = ["violet", "blue", "peach", "mint"];

function forecastFor(employee: EmployeeRecord) {
  return Number(employee.fixedSalary || 0) + Number(employee.revenue || 0) * Number(employee.revenuePercent || 0) / 100;
}

export function EmployeesView() {
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const canCreate = useCan("employees.write");
  const { data, loading, error, reload } = useApi<EmployeesResponse>("/api/employees");
  const { data: branches } = useApi<BranchResponse>("/api/branches", undefined, { enabled: canCreate });
  const { data: services } = useApi<ServicesResponse>("/api/services", undefined, { enabled: canCreate });
  const items = data?.items ?? [];
  const payrollVisible = data?.payrollVisible !== false;
  const active = items.filter((employee) => employee.isActive).length;
  const appointments = items.reduce((sum, employee) => sum + Number(employee.appointments || 0), 0);
  const revenue = items.reduce((sum, employee) => sum + Number(employee.revenue || 0), 0);
  const forecastPayroll = items.reduce((sum, employee) => sum + forecastFor(employee), 0);
  const canPrint = typeof window !== "undefined" && !insideTelegram();
  const activeServices = services?.items.filter((service) => service.isActive) ?? [];

  async function createEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError(null);
    const formData = new FormData(event.currentTarget);
    const values = { ...Object.fromEntries(formData.entries()), branchIds: formData.getAll("branchIds").map(String), serviceIds: formData.getAll("serviceIds").map(String) };
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

  function openCreate() {
    setFormError(null);
    setModalOpen(true);
  }

  return (
    <>
      <PageHeader
        eyebrow="Управление"
        title="Сотрудники"
        description={payrollVisible ? "Команда, условия начисления и прогноз зарплаты на основе фактической выручки за текущий месяц." : "Команда центра, филиалы и загрузка специалистов за текущий месяц."}
        actions={<>{canPrint ? <Button variant="secondary" onClick={() => window.print()}><Printer size={15} /> Печать</Button> : null}{canCreate ? <Button onClick={openCreate}><UserRoundPlus size={16} /> Добавить сотрудника</Button> : null}</>}
      />

      {loading && !data ? <LoadingState /> : null}
      {error && isAuthError(error) ? <AuthHint /> : null}
      {error && !isAuthError(error) ? <ErrorState message={error} onRetry={reload} /> : null}

      {data ? <>
        <div className="stat-strip">
          <div className="small-stat"><span>Активные сотрудники</span><strong>{active}</strong></div>
          {payrollVisible ? <div className="small-stat"><span>Выручка текущего месяца</span><strong className="small-stat-label">{formatCurrency(revenue)}</strong></div> : <div className="small-stat"><span>Приёмов в этом месяце</span><strong>{appointments}</strong></div>}
          {payrollVisible ? <div className="small-stat"><span>Прогноз зарплаты</span><strong className="small-stat-label">{formatCurrency(forecastPayroll)}</strong></div> : <div className="small-stat"><span>Всего в команде</span><strong>{items.length}</strong></div>}
        </div>

        {items.length === 0 ? <SectionCard title="Команда"><EmptyState title="Сотрудников пока нет" description="Добавьте специалистов и настройте для них процент или фиксированную часть." action={canCreate ? <Button onClick={openCreate}><Plus size={15} /> Добавить сотрудника</Button> : undefined} /></SectionCard> : <>
          <section className="cards-grid page-section" aria-label="Карточки сотрудников">
            {items.map((employee, index) => (
              <article className={`employee-card ${!employee.isActive ? "employee-card-inactive" : ""}`} key={employee.id}>
                <div className="employee-card-top"><div className="employee-card-name"><Avatar initials={initials(employee.fullName)} tone={tones[index % tones.length]} /><div><strong>{employee.fullName}</strong><span>{employee.position}{employee.branchName ? ` · ${employee.branchName}` : ""}</span></div></div><span className={`status-pill ${employee.isActive ? "status-active" : "status-inactive"}`}>{employee.isActive ? "Активен" : "Архив"}</span></div>
                <div className="employee-card-stats">
                  {payrollVisible ? <div className="employee-card-stat"><span>Выручка</span><strong>{formatCurrency(Number(employee.revenue || 0))}</strong></div> : null}
                  <div className="employee-card-stat"><span>Приёмов</span><strong>{Number(employee.appointments || 0)}</strong></div>
                  {payrollVisible ? <div className="employee-card-stat"><span>Прогноз</span><strong>{formatCurrency(forecastFor(employee))}</strong></div> : null}
                  {payrollVisible ? <div className="employee-card-stat"><span>Условия</span><strong>{employee.revenuePercent ? `${employee.revenuePercent}%` : formatCurrency(Number(employee.fixedSalary || 0))}</strong></div> : <div className="employee-card-stat"><span>Телефон</span><strong>{employee.phone || "—"}</strong></div>}
                </div>
              </article>
            ))}
          </section>

          {payrollVisible ? <SectionCard title="Расчёт зарплаты" subtitle="Предварительный прогноз за текущий месяц · период закрывается в разделе «Зарплата»">
            <div className="table-wrap"><ResponsiveTable className="data-table"><thead><tr><th>Сотрудник</th><th>Фиксированная часть</th><th>Процент с выручки</th><th>Приёмов</th><th>Прогноз итого</th></tr></thead><tbody>{items.map((employee, index) => {
              const percentAmount = Number(employee.revenue || 0) * Number(employee.revenuePercent || 0) / 100;
              return <tr key={employee.id}><td><div className="employee-cell"><Avatar initials={initials(employee.fullName)} tone={tones[index % tones.length]} /><div><strong>{employee.fullName}</strong><span>{employee.position}</span></div></div></td><td><Amount value={Number(employee.fixedSalary || 0)} muted /></td><td><Amount value={percentAmount} muted /></td><td>{Number(employee.appointments || 0)}</td><td><Amount value={forecastFor(employee)} /></td></tr>;
            })}</tbody></ResponsiveTable></div>
          </SectionCard> : null}
        </>}
      </> : null}

      {modalOpen ? <Modal title="Добавить сотрудника" onClose={() => setModalOpen(false)} busy={saving} footer={<><Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>Отмена</Button><Button type="submit" form="employee-form" loading={saving}>{saving ? "Сохраняем…" : "Сохранить сотрудника"}</Button></>}>
        <form id="employee-form" className="form-grid" onSubmit={createEmployee}>
          <FormField label="Имя и фамилия"><input name="fullName" required maxLength={200} placeholder="Имя сотрудника" autoFocus autoComplete="off" /></FormField>
          <FormField label="Должность"><input name="position" required maxLength={120} placeholder="Подолог" /></FormField>
          <FormField label="Телефон"><PhoneInput placeholder="+7 700 123 45 67" enterKeyHint="next" /></FormField>
          <FormField label="Email"><input name="email" type="email" maxLength={200} placeholder="employee@example.com" /></FormField>
          <FormField label="Филиалы" hint="Можно выбрать несколько филиалов. Первый будет основным."><select name="branchIds" multiple size={Math.min(4, Math.max(2, branches?.items.length ?? 2))} defaultValue={[]}>{branches?.items.filter((branch) => branch.isActive).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></FormField>
          <FormField label="Услуги сотрудника" hint={activeServices.length ? `Клиент видит только услуги этого специалиста · ${plural(activeServices.length, ["услуга", "услуги", "услуг"])} в каталоге` : "Клиент видит только услуги, которые выполняет этот специалист."}><select name="serviceIds" multiple size={Math.min(6, Math.max(3, activeServices.length || 3))} defaultValue={activeServices.map((service) => service.id)}>{activeServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></FormField>
          {payrollVisible ? <>
            <FormField label="Фиксированная часть, ₸"><input name="fixedSalary" type="number" min="0" step="1" inputMode="numeric" placeholder="0" /></FormField>
            <FormField label="Процент с выручки"><input name="revenuePercent" type="number" min="0" max="100" step="0.1" inputMode="decimal" placeholder="0" /></FormField>
          </> : null}
          {formError ? <div className="form-field-wide"><InlineError>{formError}</InlineError></div> : null}
        </form>
      </Modal> : null}
    </>
  );
}
