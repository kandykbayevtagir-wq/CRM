"use client";

import { FormEvent, useState } from "react";
import { Calculator, CheckCircle2, Download, Plus, WalletCards } from "lucide-react";
import { apiFetch, dispatchCrmEvent } from "@/lib/api-client";
import { AuthHint, EmptyState, ErrorState, FormField, isAuthError, LoadingState, Modal } from "@/components/data-state";
import { Amount, Button, PageHeader, SectionCard, StatusPill } from "@/components/ui";
import { formatCurrency, formatDate } from "@/lib/format";
import { useApi } from "@/lib/use-api";

type PayrollPeriod = { id: string; periodStart: string; periodEnd: string; status: string; totalAmount: number; closedAt: string | null };
type PayrollLine = { id: string; employeeId: string; employeeName: string; fixedAmount: number; revenueBase: number; revenuePercent: number; revenueAmount: number; bonusAmount: number; deductionAmount: number; advanceAmount: number; manualAdjustmentAmount: number; totalAmount: number };
type PayrollResponse = { ok: true; periods: PayrollPeriod[]; period?: PayrollPeriod; lines?: PayrollLine[]; adjustments?: Array<{ id: string; employeeId: string; kind: string; amount: number; reason: string }> };

export function PayrollView() {
  const { data, loading, error, reload } = useApi<PayrollResponse>("/api/payroll");
  const [selectedId, setSelectedId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState<PayrollLine | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const selected = data?.periods.find((period) => period.id === selectedId) ?? data?.periods[0];
  const detail = useApi<PayrollResponse>(selected ? `/api/payroll?id=${selected.id}` : "/api/payroll", undefined, { enabled: Boolean(selected) });

  async function createPeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage(null);
    try { const values = Object.fromEntries(new FormData(event.currentTarget).entries()); const response = await apiFetch<{ ok: true; id: string }>("/api/payroll", { method: "POST", body: values }); setSelectedId(response.id); setCreateOpen(false); dispatchCrmEvent("crm:data-changed"); await reload(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Не удалось открыть период"); } finally { setSaving(false); }
  }

  async function action(path: string, body: Record<string, unknown>, success: string) {
    setSaving(true); setMessage(null);
    try { await apiFetch(path, { method: "POST", body }); setMessage(success); dispatchCrmEvent("crm:data-changed"); await Promise.all([reload(), detail.reload()]); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Операция не выполнена"); } finally { setSaving(false); }
  }

  async function addAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected || !adjustmentOpen) return; const values = Object.fromEntries(new FormData(event.currentTarget).entries()); await action("/api/payroll/adjustment", { ...values, periodId: selected.id, employeeId: adjustmentOpen.employeeId }, "Корректировка добавлена"); setAdjustmentOpen(null);
  }

  if (loading && !data) return <LoadingState />;
  if (error && isAuthError(error)) return <AuthHint />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  const period = detail.data?.period ?? selected;
  const lines = detail.data?.lines ?? [];
  return <>
    <PageHeader eyebrow="Управление" title="Зарплата" description="Расчёт фиксированной части и процента только от оплаченной выручки завершённых приёмов." actions={<><Button variant="secondary" onClick={() => { window.location.href = "/api/export?type=payroll"; }}><Download size={15} /> CSV зарплаты</Button><Button onClick={() => setCreateOpen(true)}><Plus size={15} /> Открыть период</Button></>} />
    {message ? <p className="client-notice">{message}</p> : null}
    <div className="payroll-layout"><SectionCard title="Расчётные периоды" subtitle="Закрытый период больше не пересчитывается"><div className="payroll-period-list">{(data?.periods ?? []).map((item) => <button key={item.id} className={`payroll-period-item ${period?.id === item.id ? "payroll-period-selected" : ""}`} onClick={() => setSelectedId(item.id)}><span><strong>{formatDate(item.periodStart)} — {formatDate(item.periodEnd)}</strong><small>{item.closedAt ? `Закрыт ${formatDate(item.closedAt)}` : "Открыт для пересчёта"}</small></span><span><StatusPill status={item.status.toLowerCase()} /><strong>{formatCurrency(Number(item.totalAmount || 0))}</strong></span></button>)}</div>{!(data?.periods.length) ? <EmptyState title="Периодов пока нет" description="Откройте первый период для расчёта зарплаты." action={<Button onClick={() => setCreateOpen(true)}><Plus size={14} /> Открыть период</Button>} /> : null}</SectionCard>
      {period ? <SectionCard title="Детализация периода" subtitle={`${formatDate(period.periodStart)} — ${formatDate(period.periodEnd)}`} action={<div className="page-actions"><Button variant="secondary" onClick={() => void action("/api/payroll/calculate", { periodId: period.id }, "Период пересчитан")} disabled={saving || period.status === "CLOSED"}><Calculator size={14} /> Рассчитать</Button>{period.status === "CALCULATED" ? <Button onClick={() => void action("/api/payroll/close", { periodId: period.id }, "Период закрыт")} disabled={saving}><CheckCircle2 size={14} /> Закрыть период</Button> : null}</div>}><div className="metrics-grid payroll-metrics"><div className="metric-card metric-lavender"><div className="metric-card-top"><span>Итого</span><WalletCards size={15} /></div><strong>{formatCurrency(Number(period.totalAmount || 0))}</strong></div><div className="metric-card metric-mint"><div className="metric-card-top"><span>Сотрудников</span></div><strong>{lines.length}</strong></div></div>{lines.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Сотрудник</th><th>Фикс</th><th>Оплаченная выручка</th><th>Процент</th><th>Бонусы</th><th>Удержания / авансы</th><th>Итого</th><th /></tr></thead><tbody>{lines.map((line) => <tr key={line.id}><td><strong>{line.employeeName}</strong></td><td><Amount value={Number(line.fixedAmount || 0)} muted /></td><td><Amount value={Number(line.revenueBase || 0)} muted /></td><td>{Number(line.revenuePercent || 0)}% · {formatCurrency(Number(line.revenueAmount || 0))}</td><td>{formatCurrency(Number(line.bonusAmount || 0))}</td><td>{formatCurrency(Number(line.deductionAmount || 0) + Number(line.advanceAmount || 0))}</td><td><Amount value={Number(line.totalAmount || 0)} /></td><td>{period.status !== "CLOSED" ? <button className="inline-action" onClick={() => setAdjustmentOpen(line)}>+ / −</button> : null}</td></tr>)}</tbody></table></div> : <EmptyState title="Нажмите «Рассчитать»" description="Система соберёт оплаченные завершённые приёмы и настройки сотрудников." />}</SectionCard> : <SectionCard title="Выберите период"><EmptyState title="Расчётный период не выбран" description="Откройте период, чтобы увидеть детализацию." /></SectionCard>}
    </div>
    {createOpen ? <Modal title="Новый расчётный период" onClose={() => setCreateOpen(false)} footer={<><Button variant="secondary" onClick={() => setCreateOpen(false)}>Отмена</Button><button className="button button-primary" form="payroll-create-form" type="submit" disabled={saving}>Открыть период</button></>}><form id="payroll-create-form" className="form-grid" onSubmit={createPeriod}><FormField label="Начало"><input name="periodStart" type="date" required /></FormField><FormField label="Конец"><input name="periodEnd" type="date" required /></FormField></form></Modal> : null}
    {adjustmentOpen && period ? <Modal title={`Корректировка · ${adjustmentOpen.employeeName}`} onClose={() => setAdjustmentOpen(null)} footer={<><Button variant="secondary" onClick={() => setAdjustmentOpen(null)}>Отмена</Button><button className="button button-primary" form="payroll-adjustment-form" type="submit" disabled={saving}>Добавить</button></>}><form id="payroll-adjustment-form" className="form-grid" onSubmit={addAdjustment}><FormField label="Вид"><select name="kind" defaultValue="BONUS"><option value="BONUS">Бонус</option><option value="DEDUCTION">Удержание</option><option value="ADVANCE">Аванс</option><option value="MANUAL">Ручная корректировка</option></select></FormField><FormField label="Сумма, ₸"><input name="amount" type="number" min="0.01" step="0.01" required /></FormField><FormField label="Причина" className="form-field-wide"><textarea name="reason" required rows={3} /></FormField></form></Modal> : null}
  </>;
}
