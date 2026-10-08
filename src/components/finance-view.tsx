"use client";

import { ResponsiveTable } from "@/components/responsive-table";

import { FormEvent, useMemo, useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Download, Landmark, Plus, Printer, ReceiptText, Search, Trash2, Zap } from "lucide-react";

import { apiFetch, dispatchCrmEvent } from "@/lib/api-client";
import { AuthHint, ConfirmDialog, EmptyState, ErrorState, FormField, InlineError, isAuthError, LoadingState, Modal } from "@/components/data-state";
import { Amount, Button, PageHeader, SectionCard, StatusPill } from "@/components/ui";
import type { Branch, DashboardResponse, ExpenseRecord, ReconciliationCheck, RentRecord, UtilityRecord } from "@/lib/crm-types";
import { CENTRE_TIMEZONE, dateInputValue, dateValueInZone, formatCurrency, formatDate, formatDateTime, insideTelegram, plural } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useCan } from "@/lib/current-user";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useOperationKey } from "@/lib/use-operation-key";

type FinanceResponse = { ok: true; items: ExpenseRecord[] };
type BranchResponse = { ok: true; items: Branch[] };
type RentResponse = { ok: true; items: RentRecord[] };
type UtilityResponse = { ok: true; items: UtilityRecord[] };
type ReconciliationResponse = { ok: true; healthy: boolean; checks: ReconciliationCheck[]; checkedAt: string };

const categoryLabels: Record<string, string> = { RENT: "Аренда", UTILITIES: "Коммунальные услуги", SUPPLIES: "Расходники", MARKETING: "Маркетинг", TAX: "Налоги", EQUIPMENT: "Оборудование", SALARY: "Зарплата", OTHER: "Другое" };
const utilityKinds: Record<string, string> = { ELECTRICITY: "Электричество", WATER: "Вода", HEATING: "Отопление", INTERNET: "Интернет", TELECOM: "Связь", OTHER: "Другое" };
const obligationStatuses = [
  { value: "PLANNED", label: "Запланировано" },
  { value: "DUE", label: "К оплате" },
  { value: "PAID", label: "Оплачено" },
  { value: "OVERDUE", label: "Просрочено" },
];
const palette = ["#8f80eb", "#6bb9e4", "#79c89e", "#eda170"];

function statusKey(status: string) {
  return status.toLowerCase();
}

function addDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function ObligationStatusFields({ status, onStatusChange }: { status: string; onStatusChange: (value: string) => void }) {
  return <>
    <FormField label="Статус"><select name="status" value={status} onChange={(event) => onStatusChange(event.target.value)}>{obligationStatuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></FormField>
    {status === "PAID" ? <FormField label="Дата оплаты" hint="Время центра (Алматы)"><input name="paidAt" type="datetime-local" required defaultValue={dateInputValue()} /></FormField> : <FormField label="Дата оплаты" hint="Заполняется после оплаты"><input type="datetime-local" disabled value="" readOnly /></FormField>}
  </>;
}

export function FinanceView() {
  const operationKey = useOperationKey();
  const canWrite = useCan("finance.write");
  const canExport = useCan("exports.read");
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [voidTarget, setVoidTarget] = useState<ExpenseRecord | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const path = `/api/finance${debouncedQuery ? `?q=${encodeURIComponent(debouncedQuery.slice(0, 100))}` : ""}`;
  const { data, loading, error, reload } = useApi<FinanceResponse>(path);
  const { data: dashboard, error: dashboardError, reload: reloadDashboard } = useApi<DashboardResponse>("/api/dashboard");
  const { data: branches } = useApi<BranchResponse>("/api/branches", undefined, { enabled: canWrite });
  const { data: rentData, reload: reloadRent } = useApi<RentResponse>("/api/rent");
  const { data: utilityData, reload: reloadUtilities } = useApi<UtilityResponse>("/api/utilities");
  const { data: reconciliation, loading: reconciliationLoading, error: reconciliationError, reload: reloadReconciliation } = useApi<ReconciliationResponse>("/api/reconciliation");
  const [rentModalOpen, setRentModalOpen] = useState(false);
  const [rentStatus, setRentStatus] = useState("PLANNED");
  const [utilityModalOpen, setUtilityModalOpen] = useState(false);
  const [utilityStatus, setUtilityStatus] = useState("PLANNED");
  const [meter, setMeter] = useState({ previous: 0, current: 0, tariff: 0, fixedFee: 0 });
  const loadedItems = data?.items;
  const items = useMemo(() => loadedItems ?? [], [loadedItems]);
  const metrics = dashboard?.metrics;
  const payrollKnown = typeof metrics?.payroll === "number";
  const profit = (metrics?.revenue ?? 0) - (metrics?.expenses ?? 0) - (metrics?.payroll ?? 0);
  const margin = metrics?.revenue ? Math.round((profit / metrics.revenue) * 100) : 0;
  const categories = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of items) if (item.direction !== "INCOME") totals.set(item.category, (totals.get(item.category) ?? 0) + Number(item.amount || 0));
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);
  const activeBranches = branches?.items.filter((branch) => branch.isActive) ?? [];
  const canPrint = typeof window !== "undefined" && !insideTelegram();
  const todayValue = dateValueInZone();
  const monthStart = `${todayValue.slice(0, 7)}-01`;
  const utilityTotal = Math.max(0, meter.current - meter.previous) * meter.tariff + meter.fixedFee;
  const openObligations = [...(rentData?.items ?? []), ...(utilityData?.items ?? [])].filter((item) => item.status !== "PAID");
  const overdueObligations = openObligations.filter((item) => item.status === "OVERDUE" || new Date(item.dueDate).getTime() < Date.now());
  const monthLabel = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: CENTRE_TIMEZONE }).format(new Date());

  async function reloadAll() {
    await Promise.all([reload(), reloadDashboard(), reloadRent(), reloadUtilities(), reloadReconciliation()]);
  }

  async function submitForm(event: FormEvent<HTMLFormElement>, apiPath: string, close: () => void, fallback: string, success: string) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError(null);
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await apiFetch(apiPath, { method: "POST", body: { ...values, idempotencyKey: operationKey.get({ apiPath, ...values }) } });
      operationKey.reset();
      close();
      setNotice(success);
      dispatchCrmEvent("crm:data-changed");
      await reloadAll();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : fallback);
    } finally {
      setSaving(false);
    }
  }

  async function voidExpense() {
    if (!voidTarget?.expenseId || voiding) return;
    setVoiding(true);
    setVoidError(null);
    try {
      await apiFetch(`/api/finance/${voidTarget.expenseId}`, { method: "DELETE" });
      setNotice(`Операция «${voidTarget.title}» аннулирована и исключена из итогов.`);
      setVoidTarget(null);
      dispatchCrmEvent("crm:data-changed");
      await reloadAll();
    } catch (cause) {
      setVoidError(cause instanceof Error ? cause.message : "Не удалось аннулировать операцию");
    } finally {
      setVoiding(false);
    }
  }

  function openModal(kind: "expense" | "rent" | "utility") {
    setFormError(null);
    setNotice(null);
    if (kind === "expense") setModalOpen(true);
    if (kind === "rent") { setRentStatus("PLANNED"); setRentModalOpen(true); }
    if (kind === "utility") { setUtilityStatus("PLANNED"); setMeter({ previous: 0, current: 0, tariff: 0, fixedFee: 0 }); setUtilityModalOpen(true); }
  }

  return (
    <>
      <PageHeader eyebrow="Управление" title="Финансы" description="Доходы, расходы, аренда и коммунальные платежи считаются из проведённых операций." actions={<>
        {canExport ? <Button variant="secondary" onClick={() => { window.location.href = "/api/export?type=expenses"; }}><Download size={15} /> CSV операций</Button> : null}
        {canPrint ? <Button variant="secondary" onClick={() => window.print()}><Printer size={15} /> Печать</Button> : null}
        {canWrite ? <><Button variant="secondary" onClick={() => openModal("rent")}><Landmark size={15} /> Аренда</Button><Button variant="secondary" onClick={() => openModal("utility")}><Zap size={15} /> Коммунальные</Button><Button onClick={() => openModal("expense")}><Plus size={16} /> Добавить расход</Button></> : null}
      </>} />

      {loading && !data ? <LoadingState /> : null}
      {error && isAuthError(error) ? <AuthHint /> : null}
      {error && !isAuthError(error) && !data ? <ErrorState message={error} onRetry={() => { void reloadAll(); }} /> : null}
      {notice ? <p className="notice notice-success" role="status">{notice}</p> : null}

      {data ? <>
        <div className="metrics-grid" aria-label={`Итоги за ${monthLabel}`}>
          <div className="metric-card metric-mint"><div className="metric-card-top"><span>Доходы за месяц</span><ArrowUpRight size={16} /></div><strong>{metrics ? formatCurrency(metrics.revenue ?? 0) : "—"}</strong><div className="metric-change metric-change-neutral">оплаты завершённых приёмов</div></div>
          <div className="metric-card metric-peach"><div className="metric-card-top"><span>Расходы за месяц</span><ArrowDownRight size={16} /></div><strong>{metrics ? formatCurrency(metrics.expenses ?? 0) : "—"}</strong><div className="metric-change metric-change-neutral">проведённые операции</div></div>
          <div className="metric-card metric-lavender"><div className="metric-card-top"><span>Результат</span><ArrowUpRight size={16} /></div><strong>{metrics ? formatCurrency(profit) : "—"}</strong><div className="metric-change metric-change-neutral">{payrollKnown ? "после зарплат" : "без учёта зарплат"}</div></div>
          <div className="metric-card metric-sky"><div className="metric-card-top"><span>Рентабельность</span><ReceiptText size={16} /></div><strong>{metrics ? `${margin}%` : "—"}</strong><div className="metric-change metric-change-neutral">за {monthLabel}</div></div>
        </div>
        {dashboardError && !dashboard ? <p className="notice notice-warning" role="status">Итоги месяца временно недоступны: {dashboardError}</p> : null}

        <div className="filter-bar">
          <label className="filter-select search-input"><span>Поиск операции</span><span className="search-input-control"><Search size={15} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название или категория" maxLength={100} /></span></label>
          <div className="filter-spacer" />
          <span className="table-secondary" aria-live="polite">{debouncedQuery ? `Результаты для «${debouncedQuery}»: ${plural(items.length, ["операция", "операции", "операций"])}` : "Все операции"}</span>
        </div>

        <SectionCard title="Журнал операций" subtitle="Аннулирование и добавление фиксируются в журнале изменений">
          {items.length === 0 ? (
            debouncedQuery
              ? <EmptyState title="Ничего не найдено" description={`По запросу «${debouncedQuery}» операций нет.`} action={<Button variant="secondary" onClick={() => setQuery("")}>Сбросить поиск</Button>} />
              : <EmptyState title="Операций пока нет" description="Добавьте аренду, коммунальный платёж или другой расход — сумма появится в отчёте." action={canWrite ? <Button onClick={() => openModal("expense")}><Plus size={15} /> Добавить операцию</Button> : undefined} />
          ) : <div className="table-wrap"><ResponsiveTable className="data-table"><thead><tr><th>Операция</th><th>Категория</th><th>Филиал</th><th>Дата</th><th>Статус</th><th>Сумма</th>{canWrite ? <th><span className="visually-hidden">Действия</span></th> : null}</tr></thead><tbody>{items.map((expense) => <tr key={expense.id}><td><strong>{expense.title}</strong><span className="table-secondary">{expense.description ?? (expense.direction === "INCOME" ? "Фактическое поступление" : "")}</span></td><td>{categoryLabels[expense.category] ?? expense.category}</td><td>{expense.branchName ?? "Все филиалы"}</td><td>{formatDateTime(expense.occurredAt)}</td><td><StatusPill status={statusKey(expense.status)} /></td><td><Amount value={Number(expense.amount || 0)} /><span className="table-secondary">{expense.direction === "INCOME" ? "Доход" : "Расход"}</span></td>{canWrite ? <td>{expense.expenseId ? <button type="button" className="icon-button danger-action" onClick={() => { setVoidError(null); setVoidTarget(expense); }} aria-label={`Аннулировать операцию: ${expense.title}`} title="Аннулировать операцию"><Trash2 size={15} /></button> : null}</td> : null}</tr>)}</tbody></ResponsiveTable></div>}
        </SectionCard>

        <div className="dashboard-grid dashboard-grid-equal page-section">
          <SectionCard title="Аренда" subtitle="Плановые и оплаченные обязательства" action={canWrite ? <Button variant="ghost" onClick={() => openModal("rent")}><Plus size={14} /> Добавить</Button> : undefined}>
            {rentData?.items.length ? <div className="compact-record-list">{rentData.items.slice(0, 6).map((rent) => <div className="compact-record-row" key={rent.id}><div><strong>{rent.branchName ?? "Филиал"}</strong><span>период с {formatDate(rent.periodStart)} · срок {formatDate(rent.dueDate)}</span></div><div><Amount value={Number(rent.amount || 0)} /><StatusPill status={statusKey(rent.status)} /></div></div>)}</div> : <EmptyState title="Аренда не добавлена" description="Добавьте обязательство по филиалу и сроку оплаты." action={canWrite ? <Button onClick={() => openModal("rent")}><Landmark size={14} /> Добавить аренду</Button> : undefined} />}
          </SectionCard>
          <SectionCard title="Коммунальные" subtitle="Показания и автоматический расчёт суммы" action={canWrite ? <Button variant="ghost" onClick={() => openModal("utility")}><Plus size={14} /> Добавить</Button> : undefined}>
            {utilityData?.items.length ? <div className="compact-record-list">{utilityData.items.slice(0, 6).map((utility) => <div className="compact-record-row" key={utility.id}><div><strong>{utilityKinds[utility.kind] ?? utility.kind} · {utility.branchName ?? "Филиал"}</strong><span>{Number(utility.consumption).toLocaleString("ru-RU")} ед. × {formatCurrency(Number(utility.tariff || 0))} + {formatCurrency(Number(utility.fixedFee || 0))} · срок {formatDate(utility.dueDate)}</span></div><div><Amount value={Number(utility.amount || 0)} /><StatusPill status={statusKey(utility.status)} /></div></div>)}</div> : <EmptyState title="Коммунальных платежей нет" description="Внесите предыдущие и текущие показания — сумма посчитается автоматически." action={canWrite ? <Button onClick={() => openModal("utility")}><Zap size={14} /> Добавить платёж</Button> : undefined} />}
          </SectionCard>
        </div>

        <div className="dashboard-grid dashboard-grid-equal page-section">
          <SectionCard title="Расходы по категориям" subtitle="Фактически занесённые операции">
            {categories.length === 0 ? <EmptyState title="Категории появятся после первой операции" description="Система сама сгруппирует расходы по категориям." /> : <><div className="summary-list">{categories.map(([category, amount], index) => <div key={category}><div className="summary-row"><div className="summary-row-copy"><i style={{ background: palette[index % palette.length] }} />{categoryLabels[category] ?? category}</div><strong>{formatCurrency(amount)}</strong></div><div className="progress-track" role="presentation"><div className="progress-value" style={{ width: `${Math.max(8, Math.round((amount / Math.max(categories[0][1], 1)) * 100))}%`, background: palette[index % palette.length] }} /></div></div>)}</div><div className="summary-total"><span>Всего расходов в выборке</span><strong>{formatCurrency(categories.reduce((sum, [, amount]) => sum + amount, 0))}</strong></div></>}
          </SectionCard>
          <SectionCard title="Обязательства" subtitle="Аренда, коммунальные и зарплаты текущего месяца">
            <div className="summary-list">
              <div className="summary-row"><span className="summary-row-copy">Открытых обязательств</span><strong>{plural(openObligations.length, ["платёж", "платежа", "платежей"])}</strong></div>
              <div className="summary-row"><span className="summary-row-copy">К оплате</span><strong>{formatCurrency(openObligations.reduce((sum, item) => sum + Number(item.amount || 0), 0))}</strong></div>
              <div className="summary-row"><span className="summary-row-copy">Просрочено</span><strong className={overdueObligations.length ? "danger-text" : ""}>{overdueObligations.length ? formatCurrency(overdueObligations.reduce((sum, item) => sum + Number(item.amount || 0), 0)) : "Нет"}</strong></div>
              {payrollKnown ? <div className="summary-row"><span className="summary-row-copy">Зарплаты за {monthLabel}</span><strong>{formatCurrency(metrics?.payroll ?? 0)}</strong></div> : null}
            </div>
          </SectionCard>
        </div>

        <SectionCard title="Контроль целостности" subtitle={reconciliation ? `Сверка источников и финансового журнала · ${formatDateTime(reconciliation.checkedAt)}` : "Сверка источников и финансового журнала"} action={<Button variant="ghost" onClick={() => void reloadReconciliation()} loading={reconciliationLoading}>Проверить ещё раз</Button>}>
          {reconciliationError && !reconciliation ? <ErrorState message={reconciliationError} onRetry={reloadReconciliation} /> : null}
          {reconciliation ? <div className="reconciliation-grid">{reconciliation.checks.map((item) => <div className={`reconciliation-item ${item.ok ? "reconciliation-ok" : "reconciliation-warning"}`} key={item.key}><span className="reconciliation-icon">{item.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}</span><div><strong>{item.label}</strong><span>{item.ok ? `${plural(item.sourceCount, ["операция совпадает", "операции совпадают", "операций совпадают"])}` : `Разница ${formatCurrency(item.difference)} · источник ${item.sourceCount}, журнал ${item.ledgerCount}`}</span></div></div>)}</div> : null}
          {!reconciliation && !reconciliationError ? <p className="section-card-note">Проверка выполняется…</p> : null}
        </SectionCard>
      </> : null}

      {modalOpen ? <Modal title="Добавить расход" onClose={() => setModalOpen(false)} busy={saving} footer={<><Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>Отмена</Button><Button type="submit" form="expense-form" loading={saving}>{saving ? "Сохраняем…" : "Сохранить операцию"}</Button></>}>
        <form id="expense-form" className="form-grid" onSubmit={(event) => void submitForm(event, "/api/finance", () => setModalOpen(false), "Не удалось сохранить операцию", "Операция добавлена в журнал")}>
          <FormField label="Название операции"><input name="title" required maxLength={200} placeholder="Например, аренда кабинета" autoFocus /></FormField>
          <FormField label="Категория"><select name="category" defaultValue="OTHER">{Object.entries(categoryLabels).filter(([value]) => value !== "SALARY").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
          <FormField label="Сумма, ₸"><input name="amount" required type="number" min="1" step="1" inputMode="numeric" placeholder="0" /></FormField>
          <FormField label="Дата" hint="Время центра (Алматы)"><input name="occurredAt" type="datetime-local" required defaultValue={dateInputValue()} /></FormField>
          <FormField label="Статус"><select name="status" defaultValue="PAID"><option value="PAID">Оплачено</option><option value="PLANNED">Запланировано</option></select></FormField>
          <FormField label="Филиал"><select name="branchId" defaultValue=""><option value="">Все филиалы</option>{activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></FormField>
          <FormField label="Комментарий" className="form-field-wide"><textarea name="description" rows={3} maxLength={1000} placeholder="Примечание к операции" /></FormField>
          {formError ? <div className="form-field-wide"><InlineError>{formError}</InlineError></div> : null}
        </form>
      </Modal> : null}

      {rentModalOpen ? <Modal title="Добавить аренду" onClose={() => setRentModalOpen(false)} busy={saving} footer={<><Button variant="secondary" onClick={() => setRentModalOpen(false)} disabled={saving}>Отмена</Button><Button type="submit" form="rent-form" loading={saving}>{saving ? "Сохраняем…" : "Сохранить аренду"}</Button></>}>
        <form id="rent-form" className="form-grid" onSubmit={(event) => void submitForm(event, "/api/rent", () => setRentModalOpen(false), "Не удалось сохранить аренду", "Арендный платёж сохранён")}>
          <FormField label="Филиал"><select name="branchId" required defaultValue={activeBranches.length === 1 ? activeBranches[0].id : ""}><option value="" disabled>Выберите филиал</option>{activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></FormField>
          <FormField label="Сумма, ₸"><input name="amount" required type="number" min="1" step="1" inputMode="numeric" placeholder="0" autoFocus /></FormField>
          <FormField label="Расчётный период с"><input name="periodStart" type="date" required defaultValue={monthStart} /></FormField>
          <FormField label="Срок оплаты"><input name="dueDate" type="date" required defaultValue={addDays(monthStart, 9)} /></FormField>
          <ObligationStatusFields status={rentStatus} onStatusChange={setRentStatus} />
          <FormField label="Комментарий" className="form-field-wide"><textarea name="note" rows={3} maxLength={500} placeholder="Период, условия или примечание" /></FormField>
          {formError ? <div className="form-field-wide"><InlineError>{formError}</InlineError></div> : null}
        </form>
      </Modal> : null}

      {utilityModalOpen ? <Modal title="Добавить коммунальный платёж" onClose={() => setUtilityModalOpen(false)} busy={saving} footer={<><Button variant="secondary" onClick={() => setUtilityModalOpen(false)} disabled={saving}>Отмена</Button><Button type="submit" form="utility-form" loading={saving}>{saving ? "Сохраняем…" : "Сохранить платёж"}</Button></>}>
        <form id="utility-form" className="form-grid" onSubmit={(event) => void submitForm(event, "/api/utilities", () => setUtilityModalOpen(false), "Не удалось сохранить коммунальный платёж", "Коммунальный платёж сохранён")}>
          <FormField label="Филиал"><select name="branchId" required defaultValue={activeBranches.length === 1 ? activeBranches[0].id : ""}><option value="" disabled>Выберите филиал</option>{activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></FormField>
          <FormField label="Вид услуги"><select name="kind" defaultValue="ELECTRICITY">{Object.entries(utilityKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
          <FormField label="Расчётный период с"><input name="periodStart" type="date" required defaultValue={monthStart} /></FormField>
          <FormField label="Срок оплаты"><input name="dueDate" type="date" required defaultValue={addDays(monthStart, 24)} /></FormField>
          <FormField label="Предыдущее показание"><input name="previousMeterValue" type="number" min="0" step="0.01" inputMode="decimal" required placeholder="0" value={meter.previous} onChange={(event) => setMeter((current) => ({ ...current, previous: Number(event.target.value) || 0 }))} /></FormField>
          <FormField label="Текущее показание"><input name="currentMeterValue" type="number" min={meter.previous} step="0.01" inputMode="decimal" required placeholder="0" value={meter.current} onChange={(event) => setMeter((current) => ({ ...current, current: Number(event.target.value) || 0 }))} /></FormField>
          <FormField label="Тариф за единицу, ₸"><input name="tariff" type="number" min="0" step="0.01" inputMode="decimal" required placeholder="0" value={meter.tariff} onChange={(event) => setMeter((current) => ({ ...current, tariff: Number(event.target.value) || 0 }))} /></FormField>
          <FormField label="Фиксированная часть, ₸"><input name="fixedFee" type="number" min="0" step="0.01" inputMode="decimal" required value={meter.fixedFee} onChange={(event) => setMeter((current) => ({ ...current, fixedFee: Number(event.target.value) || 0 }))} /></FormField>
          <ObligationStatusFields status={utilityStatus} onStatusChange={setUtilityStatus} />
          <FormField label="Комментарий" className="form-field-wide"><textarea name="note" rows={3} maxLength={500} placeholder="Показания счётчика или примечание" /></FormField>
          <p className="form-hint form-field-wide" aria-live="polite">Итого: ({meter.current.toLocaleString("ru-RU")} − {meter.previous.toLocaleString("ru-RU")}) × {formatCurrency(meter.tariff)} + {formatCurrency(meter.fixedFee)} = <strong>{formatCurrency(utilityTotal)}</strong>{utilityTotal <= 0 ? " · сумма должна быть больше нуля" : ""}</p>
          {formError ? <div className="form-field-wide"><InlineError>{formError}</InlineError></div> : null}
        </form>
      </Modal> : null}

      {voidTarget ? <ConfirmDialog title="Аннулировать операцию?" description={`«${voidTarget.title}» на ${formatCurrency(Number(voidTarget.amount || 0))} будет исключена из итогов и отчётов. Запись останется в журнале изменений.`} confirmLabel="Аннулировать" danger pending={voiding} error={voidError} onConfirm={() => void voidExpense()} onClose={() => { if (!voiding) setVoidTarget(null); }} /> : null}
    </>
  );
}
