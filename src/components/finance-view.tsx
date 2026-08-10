"use client";

import { FormEvent, useDeferredValue, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Download, Plus, ReceiptText, Search, Trash2 } from "lucide-react";

import { apiFetch, dispatchCrmEvent } from "@/lib/api-client";
import { AuthHint, EmptyState, ErrorState, FormField, isAuthError, LoadingState, Modal } from "@/components/data-state";
import { Amount, Button, PageHeader, SectionCard, StatusPill } from "@/components/ui";
import type { Branch, DashboardResponse, ExpenseRecord } from "@/lib/crm-types";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { useApi } from "@/lib/use-api";

type FinanceResponse = { ok: true; items: ExpenseRecord[] };
type BranchResponse = { ok: true; items: Branch[] };

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

  async function createExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await apiFetch("/api/finance", { method: "POST", body: values });
      setModalOpen(false);
      dispatchCrmEvent("crm:data-changed");
      await Promise.all([reload(), reloadDashboard()]);
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
      await Promise.all([reload(), reloadDashboard()]);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Управление" title="Финансы" description="Доходы, расходы, аренда и коммунальные платежи без ручных итогов и тестовых сумм." actions={<><Button variant="secondary" onClick={() => window.print()}><Download size={15} /> Печать отчёта</Button><Button onClick={() => { setFormError(null); setModalOpen(true); }}><Plus size={16} /> Добавить расход</Button></>} />

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
          {items.length === 0 ? <EmptyState title="Операций пока нет" description="Добавьте аренду, коммунальный платёж или другой расход — сумма появится в отчёте." action={<Button onClick={() => setModalOpen(true)}><Plus size={15} /> Добавить операцию</Button>} /> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Операция</th><th>Категория</th><th>Филиал</th><th>Дата</th><th>Статус</th><th>Сумма</th><th /></tr></thead><tbody>{items.map((expense) => <tr key={expense.id}><td><strong>{expense.title}</strong><span className="table-secondary">{expense.description ?? ""}</span></td><td>{expense.category}</td><td>{expense.branchName ?? "Все филиалы"}</td><td>{formatDateTime(expense.occurredAt)}</td><td><StatusPill status={statusKey(expense.status)} /></td><td><Amount value={Number(expense.amount || 0)} /></td><td><button className="icon-button danger-action" onClick={() => void deleteExpense(expense.id)} disabled={deletingId === expense.id} title="Удалить операцию"><Trash2 size={15} /></button></td></tr>)}</tbody></table></div>}
        </SectionCard>

        <div className="dashboard-grid dashboard-grid-equal page-section">
          <SectionCard title="Расходы по категориям" subtitle="Фактически занесённые операции">
            {categories.length === 0 ? <EmptyState title="Категории появятся после первой операции" description="Система сама сгруппирует расходы по категориям." /> : <><div className="summary-list">{categories.map(([category, amount], index) => <div key={category}><div className="summary-row"><div className="summary-row-copy"><i style={{ background: ["#8f80eb", "#6bb9e4", "#79c89e", "#eda170"][index % 4] }} />{category}</div><strong>{formatCurrency(amount)}</strong></div><div className="progress-track"><div className="progress-value" style={{ width: `${Math.max(8, Math.round((amount / Math.max(categories[0][1], 1)) * 100))}%`, background: ["#8f80eb", "#6bb9e4", "#79c89e", "#eda170"][index % 4] }} /></div></div>)}</div><div className="summary-total"><span>Всего в выборке</span><strong>{formatCurrency(items.reduce((sum, item) => sum + Number(item.amount || 0), 0))}</strong></div></>}
          </SectionCard>
          <SectionCard title="Облачный учёт" subtitle="Данные не хранятся в браузере">
            <div className="cloud-status"><span className="cloud-status-dot" /><div><strong>Синхронизация активна</strong><span>Операции сохраняются в Cloudflare D1 и доступны из Telegram Mini App.</span></div></div>
            <div className="summary-list cloud-details"><div className="summary-row"><span className="summary-row-copy">Текущий месяц</span><strong>{new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date())}</strong></div><div className="summary-row"><span className="summary-row-copy">Зарплаты учтены</span><strong>{formatCurrency(metrics?.payroll ?? 0)}</strong></div></div>
          </SectionCard>
        </div>
      </> : null}

      {modalOpen ? <Modal title="Добавить расход" onClose={() => setModalOpen(false)} footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>Отмена</Button><button className="button button-primary" type="submit" form="expense-form" disabled={saving}>{saving ? "Сохраняем…" : "Сохранить операцию"}</button></>}>
        <form id="expense-form" className="form-grid" onSubmit={createExpense}>
          <FormField label="Название операции"><input name="title" required placeholder="Например, аренда кабинета" autoFocus /></FormField>
          <FormField label="Категория"><input name="category" required placeholder="Аренда, коммунальные, расходники" /></FormField>
          <FormField label="Сумма, ₸"><input name="amount" required type="number" min="0" step="1" placeholder="0" /></FormField>
          <FormField label="Дата"><input name="occurredAt" type="datetime-local" required defaultValue={new Date().toISOString().slice(0, 16)} /></FormField>
          <FormField label="Статус"><select name="status" defaultValue="PAID"><option value="PAID">Оплачено</option><option value="PLANNED">Запланировано</option></select></FormField>
          <FormField label="Филиал"><select name="branchId" defaultValue=""><option value="">Все филиалы</option>{branches?.items.filter((branch) => branch.isActive).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></FormField>
          <FormField label="Комментарий" className="form-field-wide"><textarea name="description" rows={3} placeholder="Примечание к операции" /></FormField>
          {formError ? <p className="form-error form-field-wide">{formError}</p> : null}
        </form>
      </Modal> : null}
    </>
  );
}
