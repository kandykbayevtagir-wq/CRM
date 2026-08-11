"use client";

import { FormEvent, useDeferredValue, useMemo, useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Download, Landmark, Plus, ReceiptText, Search, Trash2, Zap } from "lucide-react";

import { apiFetch, dispatchCrmEvent } from "@/lib/api-client";
import { AuthHint, EmptyState, ErrorState, FormField, isAuthError, LoadingState, Modal } from "@/components/data-state";
import { Amount, Button, PageHeader, SectionCard, StatusPill } from "@/components/ui";
import type { Branch, DashboardResponse, ExpenseRecord } from "@/lib/crm-types";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { useApi } from "@/lib/use-api";

type FinanceResponse = { ok: true; items: ExpenseRecord[] };
type BranchResponse = { ok: true; items: Branch[] };
type RentRecord = { id: string; branchId: string; branchName: string | null; periodStart: string; amount: number; dueDate: string; status: string; paidAt: string | null; note: string | null };
type UtilityRecord = { id: string; branchId: string; branchName: string | null; kind: string; periodStart: string; previousMeterValue: number; currentMeterValue: number; consumption: number; tariff: number; fixedFee: number; amount: number; dueDate: string; status: string; paidAt: string | null; note: string | null };
type RentResponse = { ok: true; items: RentRecord[] };
type UtilityResponse = { ok: true; items: UtilityRecord[] };
type ReconciliationCheck = { key: string; label: string; sourceAmount: number; ledgerAmount: number; difference: number; sourceCount: number; ledgerCount: number; ok: boolean };
type ReconciliationResponse = { ok: true; healthy: boolean; checks: ReconciliationCheck[]; checkedAt: string };

function statusKey(status: string) {
  return status.toLowerCase();
}

export function FinanceView() {
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);
  const path = `/api/finance${deferredQuery.trim() ? `?q=${encodeURIComponent(deferredQuery.trim())}` : ""}`;
  const { data, loading, error, reload } = useApi<FinanceResponse>(path);
  const { data: dashboard, error: dashboardError, reload: reloadDashboard } = useApi<DashboardResponse>("/api/dashboard");
  const { data: branches } = useApi<BranchResponse>("/api/branches");
  const { data: rentData, reload: reloadRent } = useApi<RentResponse>("/api/rent");
  const { data: utilityData, reload: reloadUtilities } = useApi<UtilityResponse>("/api/utilities");
  const { data: reconciliation, reload: reloadReconciliation } = useApi<ReconciliationResponse>("/api/reconciliation");
  const [rentModalOpen, setRentModalOpen] = useState(false);
  const [utilityModalOpen, setUtilityModalOpen] = useState(false);
  const items = data?.items ?? [];
  const metrics = dashboard?.metrics;
  const profit = (metrics?.revenue ?? 0) - (metrics?.expenses ?? 0) - (metrics?.payroll ?? 0);
  const margin = metrics?.revenue ? Math.round((profit / metrics.revenue) * 100) : 0;
  const categories = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of items) totals.set(item.category, (totals.get(item.category) ?? 0) + Number(item.amount || 0));
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);
  const combinedError = error ?? dashboardError;

  async function reloadAll() {
    await Promise.all([reload(), reloadDashboard(), reloadRent(), reloadUtilities(), reloadReconciliation()]);
  }

  async function createExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await apiFetch("/api/finance", { method: "POST", body: values });
      setModalOpen(false);
      dispatchCrmEvent("crm:data-changed");
      await reloadAll();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Не удалось сохранить операцию");
    } finally {
      setSaving(false);
    }
  }

  async function deleteExpense(id: string) {
    if (!window.confirm("Удалить эту операцию? Действие попадёт в журнал изменений.")) return;
    setDeletingId(id);
    try {
      await apiFetch(`/api/finance/${id}`, { method: "DELETE" });
      dispatchCrmEvent("crm:data-changed");
      await reloadAll();
    } finally {
      setDeletingId(null);
    }
  }

  async function createRent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget).entries());
      await apiFetch("/api/rent", { method: "POST", body: values });
      setRentModalOpen(false);
      dispatchCrmEvent("crm:data-changed");
      await reloadAll();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Не удалось сохранить аренду");
    } finally {
      setSaving(false);
    }
  }

  async function createUtility(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget).entries());
      await apiFetch("/api/utilities", { method: "POST", body: values });
      setUtilityModalOpen(false);
      dispatchCrmEvent("crm:data-changed");
      await reloadAll();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Не удалось сохранить коммунальный платёж");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Управление" title="Финансы" description="Доходы, расходы, аренда и коммунальные платежи без ручных итогов и тестовых сумм." actions={<><Button variant="secondary" onClick={() => { window.location.href = "/api/export?type=expenses"; }}><Download size={15} /> CSV операций</Button><Button variant="secondary" onClick={() => window.print()}><Download size={15} /> Печать отчёта</Button><Button variant="secondary" onClick={() => { setFormError(null); setRentModalOpen(true); }}><Landmark size={15} /> Аренда</Button><Button variant="secondary" onClick={() => { setFormError(null); setUtilityModalOpen(true); }}><Zap size={15} /> Коммунальные</Button><Button onClick={() => { setFormError(null); setModalOpen(true); }}><Plus size={16} /> Добавить расход</Button></>} />

      {loading && !data ? <LoadingState /> : null}
      {combinedError && isAuthError(combinedError) ? <AuthHint /> : null}
      {combinedError && !isAuthError(combinedError) ? <ErrorState message={combinedError} onRetry={() => { void Promise.all([reload(), reloadDashboard()]); }} /> : null}

      {data ? <>
        <div className="metrics-grid">
          <div className="metric-card metric-mint"><div className="metric-card-top"><span>Доходы за месяц</span><ArrowUpRight size={16} /></div><strong>{formatCurrency(metrics?.revenue ?? 0)}</strong><div className="metric-change metric-change-neutral">из завершённых приёмов</div></div>
          <div className="metric-card metric-peach"><div className="metric-card-top"><span>Расходы за месяц</span><ArrowDownRight size={16} /></div><strong>{formatCurrency(metrics?.expenses ?? 0)}</strong><div className="metric-change metric-change-neutral">из журнала операций</div></div>
          <div className="metric-card metric-lavender"><div className="metric-card-top"><span>Результат</span><ArrowUpRight size={16} /></div><strong>{formatCurrency(profit)}</strong><div className="metric-change metric-change-neutral">после зарплат</div></div>
          <div className="metric-card metric-sky"><div className="metric-card-top"><span>Рентабельность</span><ReceiptText size={16} /></div><strong>{margin}%</strong><div className="metric-change metric-change-neutral">по текущему месяцу</div></div>
        </div>

        <div className="filter-bar">
          <label className="filter-select search-input"><span>Поиск операции</span><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название или категория" /></label>
          <div className="filter-spacer" />
          <span className="table-secondary">{deferredQuery ? `Результаты для «${deferredQuery}»` : "Все операции"}</span>
        </div>

        <SectionCard title="Журнал операций" subtitle="Удаление и добавление фиксируются в журнале изменений" action={<StatusPill status="paid" />}>
          {items.length === 0 ? <EmptyState title="Операций пока нет" description="Добавьте аренду, коммунальный платёж или другой расход — сумма появится в отчёте." action={<Button onClick={() => setModalOpen(true)}><Plus size={15} /> Добавить операцию</Button>} /> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Операция</th><th>Категория</th><th>Филиал</th><th>Дата</th><th>Статус</th><th>Сумма</th><th /></tr></thead><tbody>{items.map((expense) => <tr key={expense.id}><td><strong>{expense.title}</strong><span className="table-secondary">{expense.description ?? (expense.direction === "INCOME" ? "Фактическое поступление" : "")}</span></td><td>{expense.category}</td><td>{expense.branchName ?? "Все филиалы"}</td><td>{formatDateTime(expense.occurredAt)}</td><td><StatusPill status={statusKey(expense.status)} /></td><td><Amount value={Number(expense.amount || 0)} /><span className="table-secondary">{expense.direction === "INCOME" ? "Доход" : "Расход"}</span></td><td>{expense.expenseId ? <button className="icon-button danger-action" onClick={() => void deleteExpense(expense.expenseId ?? "")} disabled={deletingId === expense.expenseId} title="Аннулировать операцию"><Trash2 size={15} /></button> : null}</td></tr>)}</tbody></table></div>}
        </SectionCard>

        <div className="dashboard-grid dashboard-grid-equal page-section">
          <SectionCard title="Аренда" subtitle="Плановые и оплаченные обязательства" action={<Button variant="ghost" onClick={() => { setFormError(null); setRentModalOpen(true); }}><Plus size={14} /> Добавить</Button>}>
            {rentData?.items.length ? <div className="compact-record-list">{rentData.items.slice(0, 6).map((rent) => <div className="compact-record-row" key={rent.id}><div><strong>{rent.branchName ?? "Филиал"}</strong><span>{rent.periodStart} · срок {rent.dueDate}</span></div><div><Amount value={Number(rent.amount || 0)} /><StatusPill status={statusKey(rent.status)} /></div></div>)}</div> : <EmptyState title="Аренда не добавлена" description="Добавьте обязательство по филиалу и сроку оплаты." action={<Button onClick={() => { setFormError(null); setRentModalOpen(true); }}><Landmark size={14} /> Добавить аренду</Button>} />}
          </SectionCard>
          <SectionCard title="Коммунальные" subtitle="Показания и автоматический расчёт суммы" action={<Button variant="ghost" onClick={() => { setFormError(null); setUtilityModalOpen(true); }}><Plus size={14} /> Добавить</Button>}>
            {utilityData?.items.length ? <div className="compact-record-list">{utilityData.items.slice(0, 6).map((utility) => <div className="compact-record-row" key={utility.id}><div><strong>{utility.kind} · {utility.branchName ?? "Филиал"}</strong><span>{utility.consumption} ед. × {formatCurrency(Number(utility.tariff || 0))} + {formatCurrency(Number(utility.fixedFee || 0))}</span></div><div><Amount value={Number(utility.amount || 0)} /><StatusPill status={statusKey(utility.status)} /></div></div>)}</div> : <EmptyState title="Коммунальных платежей нет" description="Внесите предыдущие и текущие показания — сумма посчитается автоматически." action={<Button onClick={() => { setFormError(null); setUtilityModalOpen(true); }}><Zap size={14} /> Добавить платёж</Button>} />}
          </SectionCard>
        </div>

        <div className="dashboard-grid dashboard-grid-equal page-section">
          <SectionCard title="Расходы по категориям" subtitle="Фактически занесённые операции">
            {categories.length === 0 ? <EmptyState title="Категории появятся после первой операции" description="Система сама сгруппирует расходы по категориям." /> : <><div className="summary-list">{categories.map(([category, amount], index) => <div key={category}><div className="summary-row"><div className="summary-row-copy"><i style={{ background: ["#8f80eb", "#6bb9e4", "#79c89e", "#eda170"][index % 4] }} />{category}</div><strong>{formatCurrency(amount)}</strong></div><div className="progress-track"><div className="progress-value" style={{ width: `${Math.max(8, Math.round((amount / Math.max(categories[0][1], 1)) * 100))}%`, background: ["#8f80eb", "#6bb9e4", "#79c89e", "#eda170"][index % 4] }} /></div></div>)}</div><div className="summary-total"><span>Всего в выборке</span><strong>{formatCurrency(items.reduce((sum, item) => sum + Number(item.amount || 0), 0))}</strong></div></>}
          </SectionCard>
          <SectionCard title="Облачный учёт" subtitle="Данные не хранятся в браузере">
            <div className="cloud-status"><span className="cloud-status-dot" /><div><strong>Синхронизация активна</strong><span>Операции сохраняются в Cloudflare D1 и доступны из Telegram Mini App.</span></div></div>
            <div className="summary-list cloud-details"><div className="summary-row"><span className="summary-row-copy">Текущий месяц</span><strong>{new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date())}</strong></div><div className="summary-row"><span className="summary-row-copy">Зарплаты учтены</span><strong>{formatCurrency(metrics?.payroll ?? 0)}</strong></div></div>
          </SectionCard>
        </div>

        <SectionCard title="Контроль целостности" subtitle="Сверка источников и финансового журнала" action={<Button variant="ghost" onClick={() => void reloadReconciliation()}>Проверить ещё раз</Button>}>
          <div className="reconciliation-grid">{(reconciliation?.checks ?? []).map((item) => <div className={`reconciliation-item ${item.ok ? "reconciliation-ok" : "reconciliation-warning"}`} key={item.key}><span className="reconciliation-icon">{item.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}</span><div><strong>{item.label}</strong><span>{item.ok ? `${item.sourceCount} операций совпадают` : `Разница ${formatCurrency(item.difference)} · источник ${item.sourceCount}, журнал ${item.ledgerCount}`}</span></div></div>)}</div>
          {!reconciliation ? <p className="section-card-note">Проверка пока выполняется.</p> : null}
        </SectionCard>
      </> : null}

      {modalOpen ? <Modal title="Добавить расход" onClose={() => setModalOpen(false)} footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>Отмена</Button><button className="button button-primary" type="submit" form="expense-form" disabled={saving}>{saving ? "Сохраняем…" : "Сохранить операцию"}</button></>}>
        <form id="expense-form" className="form-grid" onSubmit={createExpense}>
          <FormField label="Название операции"><input name="title" required placeholder="Например, аренда кабинета" autoFocus /></FormField>
          <FormField label="Категория"><select name="category" defaultValue="OTHER"><option value="RENT">Аренда</option><option value="UTILITIES">Коммунальные услуги</option><option value="SUPPLIES">Расходники</option><option value="MARKETING">Маркетинг</option><option value="TAX">Налоги</option><option value="EQUIPMENT">Оборудование</option><option value="OTHER">Другое</option></select></FormField>
          <FormField label="Сумма, ₸"><input name="amount" required type="number" min="0" step="1" placeholder="0" /></FormField>
          <FormField label="Дата"><input name="occurredAt" type="datetime-local" required defaultValue={new Date().toISOString().slice(0, 16)} /></FormField>
          <FormField label="Статус"><select name="status" defaultValue="PAID"><option value="PAID">Оплачено</option><option value="PLANNED">Запланировано</option></select></FormField>
          <FormField label="Филиал"><select name="branchId" defaultValue=""><option value="">Все филиалы</option>{branches?.items.filter((branch) => branch.isActive).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></FormField>
          <FormField label="Комментарий" className="form-field-wide"><textarea name="description" rows={3} placeholder="Примечание к операции" /></FormField>
          {formError ? <p className="form-error form-field-wide">{formError}</p> : null}
        </form>
      </Modal> : null}

      {rentModalOpen ? <Modal title="Добавить аренду" onClose={() => setRentModalOpen(false)} footer={<><Button variant="secondary" onClick={() => setRentModalOpen(false)}>Отмена</Button><button className="button button-primary" type="submit" form="rent-form" disabled={saving}>{saving ? "Сохраняем…" : "Сохранить аренду"}</button></>}>
        <form id="rent-form" className="form-grid" onSubmit={createRent}>
          <FormField label="Филиал"><select name="branchId" required defaultValue=""><option value="" disabled>Выберите филиал</option>{branches?.items.filter((branch) => branch.isActive).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></FormField>
          <FormField label="Сумма, ₸"><input name="amount" required type="number" min="0.01" step="0.01" placeholder="0" /></FormField>
          <FormField label="Расчётный период"><input name="periodStart" type="date" required /></FormField>
          <FormField label="Срок оплаты"><input name="dueDate" type="date" required /></FormField>
          <FormField label="Статус"><select name="status" defaultValue="PLANNED"><option value="PLANNED">Запланировано</option><option value="DUE">К оплате</option><option value="PAID">Оплачено</option><option value="OVERDUE">Просрочено</option></select></FormField>
          <FormField label="Дата оплаты"><input name="paidAt" type="datetime-local" /></FormField>
          <FormField label="Комментарий" className="form-field-wide"><textarea name="note" rows={3} placeholder="Период, условия или примечание" /></FormField>
          {formError ? <p className="form-error form-field-wide">{formError}</p> : null}
        </form>
      </Modal> : null}

      {utilityModalOpen ? <Modal title="Добавить коммунальный платёж" onClose={() => setUtilityModalOpen(false)} footer={<><Button variant="secondary" onClick={() => setUtilityModalOpen(false)}>Отмена</Button><button className="button button-primary" type="submit" form="utility-form" disabled={saving}>{saving ? "Сохраняем…" : "Сохранить платёж"}</button></>}>
        <form id="utility-form" className="form-grid" onSubmit={createUtility}>
          <FormField label="Филиал"><select name="branchId" required defaultValue=""><option value="" disabled>Выберите филиал</option>{branches?.items.filter((branch) => branch.isActive).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></FormField>
          <FormField label="Вид услуги"><select name="kind" defaultValue="ELECTRICITY"><option value="ELECTRICITY">Электричество</option><option value="WATER">Вода</option><option value="HEATING">Отопление</option><option value="INTERNET">Интернет</option><option value="TELECOM">Связь</option><option value="OTHER">Другое</option></select></FormField>
          <FormField label="Расчётный период"><input name="periodStart" type="date" required /></FormField>
          <FormField label="Срок оплаты"><input name="dueDate" type="date" required /></FormField>
          <FormField label="Предыдущее показание"><input name="previousMeterValue" type="number" min="0" step="0.01" required placeholder="0" /></FormField>
          <FormField label="Текущее показание"><input name="currentMeterValue" type="number" min="0" step="0.01" required placeholder="0" /></FormField>
          <FormField label="Тариф за единицу"><input name="tariff" type="number" min="0" step="0.01" required placeholder="0" /></FormField>
          <FormField label="Фиксированная часть"><input name="fixedFee" type="number" min="0" step="0.01" defaultValue="0" required /></FormField>
          <FormField label="Статус"><select name="status" defaultValue="PLANNED"><option value="PLANNED">Запланировано</option><option value="DUE">К оплате</option><option value="PAID">Оплачено</option><option value="OVERDUE">Просрочено</option></select></FormField>
          <FormField label="Дата оплаты"><input name="paidAt" type="datetime-local" /></FormField>
          <FormField label="Комментарий" className="form-field-wide"><textarea name="note" rows={3} placeholder="Показания счётчика или примечание" /></FormField>
          <p className="form-hint form-field-wide">Итоговая сумма: (текущее − предыдущее) × тариф + фиксированная часть.</p>
          {formError ? <p className="form-error form-field-wide">{formError}</p> : null}
        </form>
      </Modal> : null}
    </>
  );
}
