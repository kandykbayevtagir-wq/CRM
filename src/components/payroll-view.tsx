"use client";

import { ResponsiveTable } from "@/components/responsive-table";

import { FormEvent, Fragment, useState } from "react";
import { Calculator, CheckCircle2, ChevronDown, Download, Plus, WalletCards } from "lucide-react";
import { apiFetch, dispatchCrmEvent } from "@/lib/api-client";
import { AuthHint, ConfirmDialog, EmptyState, ErrorState, FormField, InlineError, isAuthError, LoadingState, Modal } from "@/components/data-state";
import { Amount, Button, PageHeader, SectionCard, StatusPill } from "@/components/ui";
import { dateValueInZone, formatCurrency, formatDate, parseDate, plural } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useCan } from "@/lib/current-user";
import { useOperationKey } from "@/lib/use-operation-key";

type PayrollPeriod = { id: string; periodStart: string; periodEnd: string; status: string; totalAmount: number; closedAt: string | null };
type PayrollPayment = { paymentId: string; appointmentId: string; paidAt: string; clientName: string; amount: number; refundedAmount: number };
type PayrollAdjustment = { employeeId: string; kind: string; amount: number; reason: string };
type PayrollLine = { id: string; employeeId: string; employeeName: string; fixedAmount: number; revenueBase: number; revenuePercent: number; revenueAmount: number; bonusAmount: number; deductionAmount: number; advanceAmount: number; manualAdjustmentAmount: number; totalAmount: number; detailsJson?: string };
type PayrollResponse = { ok: true; periods: PayrollPeriod[]; period?: PayrollPeriod; lines?: PayrollLine[]; adjustments?: Array<{ id: string; employeeId: string; kind: string; amount: number; reason: string }> };

const adjustmentLabels: Record<string, string> = { BONUS: "Бонус", DEDUCTION: "Удержание", ADVANCE: "Аванс", MANUAL: "Ручная корректировка" };

/** Period ends are stored as the exclusive next midnight; show the inclusive last day instead. */
function formatPeriodEnd(value: string) {
  const date = parseDate(value);
  if (!date) return "—";
  return formatDate(new Date(date.getTime() - 1000).toISOString());
}

function periodLabel(period: PayrollPeriod) {
  return `${formatDate(period.periodStart)} — ${formatPeriodEnd(period.periodEnd)}`;
}

function lineDetails(line: PayrollLine): { payments: PayrollPayment[]; adjustments: PayrollAdjustment[] } {
  if (!line.detailsJson) return { payments: [], adjustments: [] };
  try {
    const parsed = JSON.parse(line.detailsJson) as { payments?: PayrollPayment[]; adjustments?: PayrollAdjustment[] };
    return { payments: parsed.payments ?? [], adjustments: parsed.adjustments ?? [] };
  } catch {
    return { payments: [], adjustments: [] };
  }
}

export function PayrollView() {
  const adjustmentKey = useOperationKey();
  const { data, loading, error, reload } = useApi<PayrollResponse>("/api/payroll");
  const canWrite = useCan("payroll.write");
  const canExport = useCan("exports.read");
  const [selectedId, setSelectedId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState<PayrollLine | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [expandedLine, setExpandedLine] = useState<string | null>(null);
  const selected = data?.periods.find((period) => period.id === selectedId) ?? data?.periods[0];
  const detail = useApi<PayrollResponse>(selected ? `/api/payroll?id=${selected.id}` : "/api/payroll", undefined, { enabled: Boolean(selected) });
  const todayValue = dateValueInZone();
  const monthStart = `${todayValue.slice(0, 7)}-01`;

  async function createPeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (String(values.periodEnd) < String(values.periodStart)) { setFormError("Дата окончания раньше даты начала"); return; }
    setSaving(true); setFormError(null); setMessage(null);
    try {
      const response = await apiFetch<{ ok: true; id: string }>("/api/payroll", { method: "POST", body: values });
      setSelectedId(response.id); setCreateOpen(false); dispatchCrmEvent("crm:data-changed"); await reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Не удалось открыть период");
    } finally { setSaving(false); }
  }

  async function action(path: string, body: Record<string, unknown>, success: string) {
    if (saving) return false;
    setSaving(true); setMessage(null);
    try {
      await apiFetch(path, { method: "POST", body });
      setMessage({ tone: "success", text: success }); dispatchCrmEvent("crm:data-changed");
      await Promise.all([reload(), detail.reload()]);
      return true;
    } catch (cause) {
      setMessage({ tone: "error", text: cause instanceof Error ? cause.message : "Операция не выполнена" });
      return false;
    } finally { setSaving(false); }
  }

  async function addAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !adjustmentOpen || saving) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    setFormError(null);
    setSaving(true);
    try {
      const body = { ...values, periodId: selected.id, employeeId: adjustmentOpen.employeeId };
      await apiFetch("/api/payroll/adjustment", { method: "POST", body: { ...body, idempotencyKey: adjustmentKey.get(body) } });
      adjustmentKey.reset();
      setMessage({ tone: "success", text: `Корректировка для ${adjustmentOpen.employeeName} добавлена. Нажмите «Рассчитать», чтобы обновить итоги.` });
      setAdjustmentOpen(null);
      dispatchCrmEvent("crm:data-changed");
      await Promise.all([reload(), detail.reload()]);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Не удалось добавить корректировку");
    } finally { setSaving(false); }
  }

  async function closePeriod() {
    if (!period) return;
    const ok = await action("/api/payroll/close", { periodId: period.id }, "Период закрыт: суммы зафиксированы и проведены в расходы");
    if (ok) setCloseOpen(false);
  }

  if (loading && !data) return <LoadingState />;
  if (error && isAuthError(error)) return <AuthHint />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  const period = detail.data?.period ?? selected;
  const lines = detail.data?.lines ?? [];
  const periodOpen = period ? period.status !== "CLOSED" : false;

  return <>
    <PageHeader eyebrow="Управление" title="Зарплата" description="Расчёт фиксированной части и процента только от оплаченной выручки завершённых приёмов." actions={<>{canExport ? <Button variant="secondary" onClick={() => { window.location.href = "/api/export?type=payroll"; }}><Download size={15} /> CSV зарплаты</Button> : null}{canWrite ? <Button onClick={() => { setFormError(null); setCreateOpen(true); }}><Plus size={15} /> Открыть период</Button> : null}</>} />
    {message ? <p className={`notice ${message.tone === "error" ? "notice-error" : "notice-success"}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p> : null}
    <div className="payroll-layout">
      <SectionCard title="Расчётные периоды" subtitle="Закрытый период больше не пересчитывается">
        <div className="payroll-period-list" role="list">{(data?.periods ?? []).map((item) => <button type="button" role="listitem" key={item.id} className={`payroll-period-item ${period?.id === item.id ? "payroll-period-selected" : ""}`} aria-pressed={period?.id === item.id} onClick={() => setSelectedId(item.id)}><span><strong>{periodLabel(item)}</strong><small>{item.closedAt ? `Закрыт ${formatDate(item.closedAt)}` : "Открыт для пересчёта"}</small></span><span><StatusPill status={item.status.toLowerCase()} /><strong>{formatCurrency(Number(item.totalAmount || 0))}</strong></span></button>)}</div>
        {!(data?.periods.length) ? <EmptyState title="Периодов пока нет" description="Откройте первый период для расчёта зарплаты." action={canWrite ? <Button onClick={() => { setFormError(null); setCreateOpen(true); }}><Plus size={14} /> Открыть период</Button> : undefined} /> : null}
      </SectionCard>
      {period ? <SectionCard title="Детализация периода" subtitle={periodLabel(period)} action={canWrite && periodOpen ? <div className="page-actions"><Button variant="secondary" onClick={() => void action("/api/payroll/calculate", { periodId: period.id }, "Период пересчитан по оплаченным приёмам")} loading={saving}><Calculator size={14} /> Рассчитать</Button>{period.status === "CALCULATED" ? <Button onClick={() => setCloseOpen(true)} disabled={saving}><CheckCircle2 size={14} /> Закрыть период</Button> : null}</div> : undefined}>
        {detail.loading && !detail.data ? <LoadingState label="Загружаем детализацию…" /> : null}
        {detail.error && !detail.data ? <ErrorState message={detail.error} onRetry={detail.reload} /> : null}
        <div className="metrics-grid payroll-metrics"><div className="metric-card metric-lavender"><div className="metric-card-top"><span>Итого</span><WalletCards size={15} /></div><strong>{formatCurrency(Number(period.totalAmount || 0))}</strong></div><div className="metric-card metric-mint"><div className="metric-card-top"><span>Сотрудников</span></div><strong>{lines.length}</strong></div></div>
        {lines.length ? <div className="table-wrap"><ResponsiveTable className="data-table"><thead><tr><th>Сотрудник</th><th>Фикс</th><th>Оплаченная выручка</th><th>Процент</th><th>Бонусы</th><th>Удержания / авансы</th><th>Итого</th><th><span className="visually-hidden">Действия</span></th></tr></thead><tbody>{lines.map((line) => {
          const details = lineDetails(line);
          const isExpanded = expandedLine === line.id;
          return <Fragment key={line.id}>
            <tr><td><button type="button" className="payroll-drilldown" aria-expanded={isExpanded} aria-controls={`payroll-line-${line.id}`} onClick={() => setExpandedLine(isExpanded ? null : line.id)}><ChevronDown size={14} className={isExpanded ? "rotated" : ""} aria-hidden="true" /><strong>{line.employeeName}</strong></button></td><td><Amount value={Number(line.fixedAmount || 0)} muted /></td><td><Amount value={Number(line.revenueBase || 0)} muted /></td><td>{Number(line.revenuePercent || 0)}% · {formatCurrency(Number(line.revenueAmount || 0))}</td><td>{formatCurrency(Number(line.bonusAmount || 0))}</td><td>{formatCurrency(Number(line.deductionAmount || 0) + Number(line.advanceAmount || 0))}</td><td><Amount value={Number(line.totalAmount || 0)} /></td><td>{canWrite && periodOpen ? <button type="button" className="inline-action" onClick={() => { setFormError(null); setAdjustmentOpen(line); }} aria-label={`Корректировка: ${line.employeeName}`}>+ / −</button> : null}</td></tr>
            {isExpanded ? <tr id={`payroll-line-${line.id}`}><td colSpan={8}><div className="payroll-breakdown"><strong>Источники начисления</strong><span>Фикс: {formatCurrency(Number(line.fixedAmount || 0))}</span><span>Оплаченная выручка: {formatCurrency(Number(line.revenueBase || 0))} × {Number(line.revenuePercent || 0)}% = {formatCurrency(Number(line.revenueAmount || 0))}</span>{details.payments.length ? <div className="simple-list">{details.payments.map((payment) => <div key={payment.paymentId}><span>{payment.clientName} · {formatDate(payment.paidAt)}</span><strong>{formatCurrency(Number(payment.amount || 0) - Number(payment.refundedAmount || 0))}</strong></div>)}</div> : <span className="muted-text">Оплаченных приёмов в периоде нет.</span>}{details.adjustments.map((adjustment, index) => <span key={`${adjustment.kind}-${index}`}>{adjustmentLabels[adjustment.kind] ?? adjustment.kind}: {formatCurrency(Number(adjustment.amount || 0))} · {adjustment.reason}</span>)}</div></td></tr> : null}
          </Fragment>;
        })}</tbody></ResponsiveTable></div> : (detail.data ? <EmptyState title={periodOpen && canWrite ? "Нажмите «Рассчитать»" : "Строк начисления нет"} description={periodOpen && canWrite ? "Система соберёт оплаченные завершённые приёмы и настройки сотрудников." : "В этом периоде начисления не рассчитывались."} /> : null)}
      </SectionCard> : <SectionCard title="Выберите период"><EmptyState title="Расчётный период не выбран" description="Откройте период, чтобы увидеть детализацию." /></SectionCard>}
    </div>
    {createOpen ? <Modal title="Новый расчётный период" onClose={() => setCreateOpen(false)} busy={saving} footer={<><Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={saving}>Отмена</Button><Button form="payroll-create-form" type="submit" loading={saving}>{saving ? "Открываем…" : "Открыть период"}</Button></>}>
      <form id="payroll-create-form" className="form-grid" onSubmit={createPeriod}>
        <p className="modal-intro form-field-wide">Обе даты включаются в период. Периоды не могут пересекаться.</p>
        <FormField label="Начало"><input name="periodStart" type="date" required defaultValue={monthStart} /></FormField>
        <FormField label="Конец"><input name="periodEnd" type="date" required defaultValue={todayValue} /></FormField>
        {formError ? <div className="form-field-wide"><InlineError>{formError}</InlineError></div> : null}
      </form>
    </Modal> : null}
    {adjustmentOpen && period ? <Modal title={`Корректировка · ${adjustmentOpen.employeeName}`} onClose={() => setAdjustmentOpen(null)} busy={saving} footer={<><Button variant="secondary" onClick={() => setAdjustmentOpen(null)} disabled={saving}>Отмена</Button><Button form="payroll-adjustment-form" type="submit" loading={saving}>{saving ? "Сохраняем…" : "Добавить"}</Button></>}>
      <form id="payroll-adjustment-form" className="form-grid" onSubmit={addAdjustment}>
        <FormField label="Вид"><select name="kind" defaultValue="BONUS">{Object.entries(adjustmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
        <FormField label="Сумма, ₸"><input name="amount" type="number" min="0.01" step="0.01" inputMode="decimal" required autoFocus /></FormField>
        <FormField label="Причина" className="form-field-wide"><textarea name="reason" required maxLength={500} rows={3} placeholder="За что начисляется или удерживается сумма" /></FormField>
        {formError ? <div className="form-field-wide"><InlineError>{formError}</InlineError></div> : null}
      </form>
    </Modal> : null}
    {closeOpen && period ? <ConfirmDialog title="Закрыть расчётный период?" description={`${periodLabel(period)} · ${formatCurrency(Number(period.totalAmount || 0))} по ${plural(lines.length, ["сотруднику", "сотрудникам", "сотрудникам"])}. После закрытия суммы фиксируются, пересчёт и корректировки станут недоступны, а зарплата попадёт в расходы.`} confirmLabel="Закрыть период" pending={saving} onConfirm={() => void closePeriod()} onClose={() => { if (!saving) setCloseOpen(false); }} /> : null}
  </>;
}
