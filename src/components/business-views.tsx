"use client";

import { ResponsiveTable } from "@/components/responsive-table";

import { Check, Download, PackagePlus, Plus, RefreshCw, Send, ShoppingCart, Target } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

import { apiFetch, dispatchCrmEvent } from "@/lib/api-client";
import { ConfirmDialog, EmptyState, ErrorState, FormField, InlineError, LoadingState, Modal } from "@/components/data-state";
import { Amount, Button, MetricCard, PageHeader, SectionCard, StatusPill } from "@/components/ui";
import { dateInputValue, dateValueInZone, formatCurrency, formatDate, formatDateTime, plural } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useCan } from "@/lib/current-user";
import { useOperationKey } from "@/lib/use-operation-key";

type BranchItem = { id: string; name: string; isActive: number };
type ServiceItem = { id: string; name: string; price: number; isActive: number };
type InventoryItem = { id: string; name: string; sku: string; unit: string; purchasePrice: number; salePrice: number; minStock: number; optimalStock: number; currentStock: number; lowStock: number; categoryName: string | null; supplierName: string | null; branchId: string | null };
type PnlResponse = { ok: true; current: { metrics: Record<string, number>; serviceRevenue: Array<Record<string, string | number>>; employeeRevenue: Array<Record<string, string | number>>; revenueByDay: Array<{ day: string; amount: number }>; expenseBreakdown: Array<{ category: string; amount: number }> }; comparison: Record<string, { value: number; previous: number; change: number; changePercent: number | null }> };
type KpiRow = { employeeId: string; employeeName: string; completedAppointments: number; revenue: number; averageCheck: number; availableMinutes: number; occupiedMinutes: number; freeMinutes: number; occupancy: number; noShows: number; cancellations: number; refunds: number; newClients: number; returningClients: number; repeatBookingRate: number; consumablesCost: number; contributionMargin: number; payroll: number };
type GoalRow = { id: string; metric: string; targetValue: number; fact: number; completionPercent: number; forecast: number; periodStart: string; periodEnd: string; branchId?: string | null; employeeId?: string | null };
type RetentionClient = { id: string; fullName: string; phone: string; visits: number; revenue: number; averageCheck: number; lastVisit: string | null; cancellations: number; noShows: number };
type RetentionSegment = { id: string; name: string; description: string | null; count: number; system: boolean };
type TaskRow = { id: string; title: string; description: string | null; dueDate: string | null; priority: string; status: string; clientName: string | null; assigneeName: string | null };
type CampaignRow = { id: string; name: string; message: string; status: string; recipientCount: number; sentCount: number; errorCount: number; scheduledAt: string | null };
type PurchaseRow = { id: string; supplierName: string | null; branchName: string; orderDate: string; status: string; totalAmount: number; paidAmount: number; itemCount: number };
type PurchaseItem = { id: string; productName?: string; unit?: string; orderedQuantity: number; receivedQuantity: number; unitCost: number };
type SupplierRow = { id: string; name: string; contactName: string | null; phone: string | null; telegram: string | null; whatsapp: string | null; email: string | null; notes: string | null; isActive: number };

const metricLabels: Record<string, string> = { REVENUE: "Выручка", CLIENTS: "Клиенты", AVERAGE_CHECK: "Средний чек", REPEAT_BOOKINGS: "Повторные записи" };
const priorityLabels: Record<string, string> = { LOW: "Низкий", NORMAL: "Обычный", HIGH: "Высокий", URGENT: "Срочный" };
const movementTypes: Array<{ value: string; label: string; direction: "IN" | "OUT" | null }> = [
  { value: "MANUAL_IN", label: "Ручной приход", direction: "IN" },
  { value: "MANUAL_OUT", label: "Ручное списание", direction: "OUT" },
  { value: "RETURN", label: "Возврат на склад", direction: "IN" },
  { value: "WRITE_OFF", label: "Списание (брак, срок)", direction: "OUT" },
  { value: "CORRECTION", label: "Корректировка остатка", direction: null },
];

function errorText(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

/** Current calendar month in the centre's timezone, as date-only values the API treats as inclusive local days. */
function currentMonthRange() {
  const today = dateValueInZone();
  const [year, month] = today.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${today.slice(0, 7)}-01`, to: `${today.slice(0, 7)}-${String(lastDay).padStart(2, "0")}` };
}

function usePeriodPath(path: string) {
  const initial = useMemo(currentMonthRange, []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const valid = Boolean(from && to && from <= to);
  return { from, to, setFrom, setTo, valid, path: `${path}?from=${from}&to=${to}` };
}

function PeriodToolbar({ period }: { period: ReturnType<typeof usePeriodPath> }) {
  return <div className="period-toolbar" role="group" aria-label="Период отчёта">
    <label>С <input type="date" value={period.from} max={period.to || undefined} onChange={(event) => { if (event.target.value) period.setFrom(event.target.value); }} /></label>
    <label>По <input type="date" value={period.to} min={period.from || undefined} onChange={(event) => { if (event.target.value) period.setTo(event.target.value); }} /></label>
    {!period.valid ? <InlineError>Дата начала позже даты окончания</InlineError> : null}
  </div>;
}

function percentLabel(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "нет данных за прошлый период";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("ru-RU")}% к прошлому периоду`;
}

export function InventoryView() {
  const canWrite = useCan("inventory.write");
  const { data, loading, error, reload } = useApi<{ ok: true; items: InventoryItem[] }>("/api/inventory");
  const { data: branches } = useApi<{ ok: true; branches: BranchItem[] }>("/api/settings", undefined, { enabled: canWrite });
  const { data: services } = useApi<{ ok: true; items: ServiceItem[] }>("/api/services", undefined, { enabled: canWrite });
  const { data: categories } = useApi<{ ok: true; items: Array<{ id: string; name: string }> }>("/api/inventory/categories", undefined, { enabled: canWrite });
  const { data: suppliers } = useApi<{ ok: true; items: SupplierRow[] }>("/api/inventory/suppliers", undefined, { enabled: canWrite });
  const [modal, setModal] = useState<"product" | "movement" | "consumable" | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [movementType, setMovementType] = useState("MANUAL_IN");
  const movementKey = useOperationKey();
  const activeBranches = branches?.branches?.filter((branch) => branch.isActive) ?? [];
  const forcedDirection = movementTypes.find((type) => type.value === movementType)?.direction ?? null;

  function openModal(kind: "product" | "movement" | "consumable", productId = "") {
    setFormError(null);
    setNotice(null);
    setSelectedProduct(productId);
    setModal(kind);
  }

  async function submit(event: FormEvent<HTMLFormElement>, path: string, body: Record<string, unknown>, success: string) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setFormError(null);
    try {
      await apiFetch(path, { method: "POST", body: path === "/api/inventory/movements" ? { ...body, idempotencyKey: movementKey.get(body) } : body });
      movementKey.reset(); setModal(null); setNotice(success); dispatchCrmEvent("crm:data-changed");
    } catch (cause) { setFormError(errorText(cause, "Не удалось сохранить")); } finally { setSaving(false); }
  }
  const items = data?.items ?? [];
  const lowStock = items.filter((item) => Number(item.lowStock) === 1).length;
  return <>
    <PageHeader eyebrow="Операции / склад" title="Остатки и материалы" description="Остаток считается по журналу движений: каждая корректировка попадает в аудит." actions={canWrite ? <div className="page-actions"><Button onClick={() => openModal("movement")} disabled={!items.length}><PackagePlus size={15} /> Движение</Button><Button variant="secondary" onClick={() => openModal("product")}><Plus size={15} /> Новый товар</Button></div> : undefined} />
    {notice ? <p className="notice notice-success" role="status">{notice}</p> : null}
    {loading && !data ? <LoadingState /> : null}{error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
    {data ? <SectionCard title="Товары" subtitle={lowStock ? `${plural(lowStock, ["позиция требует", "позиции требуют", "позиций требуют"])} пополнения` : "Остатки в норме"} action={<Button variant="ghost" onClick={() => void reload()} loading={loading} aria-label="Обновить остатки"><RefreshCw size={14} /></Button>}>
      {!items.length ? <EmptyState title="Склад пока пуст" description="Создайте товар, затем оформите приход через закупку или движение." action={canWrite ? <Button onClick={() => openModal("product")}><Plus size={14} /> Новый товар</Button> : undefined} /> : <div className="table-wrap"><ResponsiveTable className="data-table"><thead><tr><th>Товар</th><th>Категория</th><th>Остаток</th><th>Мин.</th><th>Закупка</th><th>Поставщик</th>{canWrite ? <th><span className="visually-hidden">Действия</span></th> : null}</tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.sku}</small></td><td>{item.categoryName ?? "—"}</td><td><span className={Number(item.lowStock) === 1 ? "danger-text" : ""}>{Number(item.currentStock ?? 0).toLocaleString("ru-RU")} {item.unit}</span></td><td>{Number(item.minStock ?? 0).toLocaleString("ru-RU")}</td><td><Amount value={Number(item.purchasePrice ?? 0)} /></td><td>{item.supplierName ?? "—"}</td>{canWrite ? <td><Button variant="ghost" onClick={() => openModal("movement", item.id)}>Списать / внести</Button></td> : null}</tr>)}</tbody></ResponsiveTable></div>}
    </SectionCard> : null}
    {canWrite ? <SectionCard title="Расходники услуг" subtitle="Списываются автоматически при завершении приёма"><Button variant="secondary" onClick={() => openModal("consumable")} disabled={!items.length}><Plus size={14} /> Привязать расходник</Button><p className="section-card-note">Норму расхода можно задать для всех филиалов или отдельно для конкретного.</p></SectionCard> : null}
    {modal === "product" ? <Modal title="Новый товар" onClose={() => setModal(null)} busy={saving} footer={<><Button variant="secondary" onClick={() => setModal(null)} disabled={saving}>Отмена</Button><Button type="submit" form="product-form" loading={saving}>{saving ? "Сохраняем…" : "Создать товар"}</Button></>}><form id="product-form" className="form-grid" onSubmit={(event) => { const form = new FormData(event.currentTarget); void submit(event, "/api/inventory", { name: form.get("name"), sku: form.get("sku"), unit: form.get("unit"), categoryId: form.get("categoryId") || null, supplierId: form.get("supplierId") || null, purchasePrice: Number(form.get("purchasePrice")), salePrice: Number(form.get("salePrice")), minStock: Number(form.get("minStock")), optimalStock: Number(form.get("optimalStock")), branchId: form.get("branchId") || null }, "Товар создан"); }}><FormField label="Название"><input name="name" required maxLength={200} autoFocus /></FormField><FormField label="Артикул (SKU)"><input name="sku" required maxLength={64} /></FormField><FormField label="Категория"><select name="categoryId"><option value="">Без категории</option>{categories?.items.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></FormField><FormField label="Поставщик"><select name="supplierId"><option value="">Не выбран</option>{suppliers?.items.filter((supplier) => supplier.isActive).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></FormField><FormField label="Единица"><input name="unit" defaultValue="шт" maxLength={16} /></FormField><FormField label="Закупочная цена, ₸"><input name="purchasePrice" type="number" min="0" step="0.01" inputMode="decimal" required /></FormField><FormField label="Цена продажи, ₸"><input name="salePrice" type="number" min="0" step="0.01" inputMode="decimal" defaultValue="0" /></FormField><FormField label="Минимальный остаток"><input name="minStock" type="number" min="0" step="0.001" inputMode="decimal" defaultValue="0" /></FormField><FormField label="Оптимальный остаток"><input name="optimalStock" type="number" min="0" step="0.001" inputMode="decimal" defaultValue="0" /></FormField><FormField label="Филиал"><select name="branchId"><option value="">Общий товар</option>{activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></FormField>{formError ? <div className="form-field-wide"><InlineError>{formError}</InlineError></div> : null}</form></Modal> : null}
    {modal === "movement" ? <Modal title="Движение склада" onClose={() => setModal(null)} busy={saving} footer={<><Button variant="secondary" onClick={() => setModal(null)} disabled={saving}>Отмена</Button><Button type="submit" form="movement-form" loading={saving}>{saving ? "Проводим…" : "Провести движение"}</Button></>}><form id="movement-form" className="form-grid" onSubmit={(event) => { const form = new FormData(event.currentTarget); void submit(event, "/api/inventory/movements", { productId: form.get("productId"), branchId: form.get("branchId"), movementType: form.get("movementType"), direction: forcedDirection ?? form.get("direction"), quantity: Number(form.get("quantity")), unitPrice: Number(form.get("unitPrice")), comment: form.get("comment") }, "Движение проведено, остаток обновлён"); }}><FormField label="Товар"><select name="productId" required defaultValue={selectedProduct}>{items.map((item) => <option key={item.id} value={item.id}>{item.name} · {Number(item.currentStock ?? 0).toLocaleString("ru-RU")} {item.unit}</option>)}</select></FormField><FormField label="Филиал"><select name="branchId" required>{activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></FormField><FormField label="Тип"><select name="movementType" value={movementType} onChange={(event) => setMovementType(event.target.value)}>{movementTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></FormField><FormField label="Направление" hint={forcedDirection ? "Определяется типом движения" : undefined}>{forcedDirection ? <input value={forcedDirection === "IN" ? "Приход" : "Расход"} readOnly aria-readonly="true" /> : <select name="direction"><option value="IN">Приход</option><option value="OUT">Расход</option></select>}</FormField><FormField label="Количество"><input name="quantity" type="number" min="0.001" step="0.001" inputMode="decimal" required /></FormField><FormField label="Цена за единицу, ₸"><input name="unitPrice" type="number" min="0" step="0.01" inputMode="decimal" defaultValue="0" /></FormField><FormField label="Комментарий" className="form-field-wide"><textarea name="comment" maxLength={500} rows={2} /></FormField>{formError ? <div className="form-field-wide"><InlineError>{formError}</InlineError></div> : null}</form></Modal> : null}
    {modal === "consumable" ? <Modal title="Расходник услуги" onClose={() => setModal(null)} busy={saving} footer={<><Button variant="secondary" onClick={() => setModal(null)} disabled={saving}>Отмена</Button><Button type="submit" form="consumable-form" loading={saving}>{saving ? "Сохраняем…" : "Привязать"}</Button></>}><form id="consumable-form" className="form-grid" onSubmit={(event) => { const form = new FormData(event.currentTarget); void submit(event, "/api/inventory/consumables", { serviceId: form.get("serviceId"), productId: form.get("productId"), branchId: form.get("branchId") || null, quantity: Number(form.get("quantity")) }, "Расходник привязан к услуге"); }}><FormField label="Услуга"><select name="serviceId" required>{services?.items?.filter((service) => service.isActive).map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></FormField><FormField label="Материал"><select name="productId" required>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></FormField><FormField label="Филиал"><select name="branchId"><option value="">Все филиалы</option>{activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></FormField><FormField label="Количество на услугу"><input name="quantity" type="number" min="0.001" step="0.001" inputMode="decimal" required /></FormField>{formError ? <div className="form-field-wide"><InlineError>{formError}</InlineError></div> : null}</form></Modal> : null}
  </>;
}

export function PnlView() {
  const period = usePeriodPath("/api/pnl");
  const canExport = useCan("exports.read");
  const { data, loading, error, reload } = useApi<PnlResponse>(period.path, undefined, { enabled: period.valid });
  const metrics = data?.current.metrics;
  const money = (key: string) => formatCurrency(Number(metrics?.[key] ?? 0));
  const maxRevenue = Math.max(1, ...(data?.current.revenueByDay.map((row) => row.amount) ?? [0]));
  const maxExpense = Math.max(1, ...(data?.current.expenseBreakdown.map((row) => row.amount) ?? [0]));
  const trendFor = (key: string): "up" | "down" | "neutral" => { const change = data?.comparison[key]?.change ?? 0; return change > 0 ? "up" : change < 0 ? "down" : "neutral"; };
  return <>
    <PageHeader eyebrow="Финансовая модель" title="Прибыль и убытки" description="Управленческая прибыль отделена от движения денег: выручка, себестоимость, зарплаты и обязательства считаются раздельно." actions={canExport ? <Button variant="secondary" onClick={() => { window.location.href = `/api/export?type=pnl&from=${period.from}&to=${period.to}`; }} disabled={!period.valid}><Download size={14} /> CSV отчёта</Button> : undefined} />
    <PeriodToolbar period={period} />
    {loading && !data ? <LoadingState /> : null}{error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
    {data && metrics ? <>
      <section className="metrics-grid" aria-label="Итоги периода"><MetricCard label="Чистая выручка" value={money("netRevenue")} change={percentLabel(data.comparison.netRevenue?.changePercent)} trend={trendFor("netRevenue")} tone="violet" /><MetricCard label="Валовая прибыль" value={money("grossProfit")} change={percentLabel(data.comparison.grossProfit?.changePercent)} trend={trendFor("grossProfit")} tone="mint" /><MetricCard label="Операционная прибыль" value={money("operatingProfit")} change={percentLabel(data.comparison.operatingProfit?.changePercent)} trend={trendFor("operatingProfit")} tone="peach" /><MetricCard label="Маржа" value={`${Number(metrics.margin ?? 0).toLocaleString("ru-RU")}%`} change="операционная прибыль к чистой выручке" trend="neutral" tone="blue" /></section>
      <div className="split-grid">
        <SectionCard title="Выручка по дням" subtitle="Чистая выручка после возвратов"><div className="chart-bars" role="img" aria-label={data.current.revenueByDay.length ? `Выручка по дням: ${data.current.revenueByDay.map((row) => `${row.day} — ${formatCurrency(row.amount)}`).join(", ")}` : "Нет операций за период"}>{data.current.revenueByDay.length ? data.current.revenueByDay.map((row) => <div className="chart-bar-column" key={row.day}><div className="chart-bar-track"><div className="chart-bar-fill" style={{ height: `${Math.max(4, row.amount / maxRevenue * 100)}%` }} title={`${formatDate(row.day)}: ${formatCurrency(row.amount)}`} /></div><small>{row.day.slice(8)}.{row.day.slice(5, 7)}</small></div>) : <span className="muted-text">Нет операций за период</span>}</div></SectionCard>
        <SectionCard title="Расходы по категориям"><div className="chart-bars chart-bars-horizontal">{data.current.expenseBreakdown.length ? data.current.expenseBreakdown.map((row) => <div className="chart-horizontal-row" key={row.category}><span>{row.category}</span><div className="chart-horizontal-track"><div className="chart-horizontal-fill" style={{ width: `${Math.max(4, row.amount / maxExpense * 100)}%` }} /></div><strong>{formatCurrency(row.amount)}</strong></div>) : <span className="muted-text">Нет расходов за период</span>}</div></SectionCard>
      </div>
      <SectionCard title="Структура отчёта"><div className="financial-breakdown"><div><span>Валовые оплаты</span><strong>{money("grossRevenue")}</strong></div><div><span>Возвраты</span><strong className="danger-text">− {money("refunds")}</strong></div><div><span>Расходники</span><strong>− {money("consumables")}</strong></div><div><span>Зарплаты</span><strong>− {money("payroll")}</strong></div><div><span>Аренда и коммунальные</span><strong>− {formatCurrency(Number(metrics.rent ?? 0) + Number(metrics.utilities ?? 0))}</strong></div><div><span>Прочие расходы</span><strong>− {money("otherExpenses")}</strong></div><div className="financial-breakdown-total"><span>Операционная прибыль</span><strong>{money("operatingProfit")}</strong></div></div></SectionCard>
      <div className="split-grid">
        <SectionCard title="По услугам">{data.current.serviceRevenue.length ? <div className="simple-list">{data.current.serviceRevenue.map((row) => <div className="simple-list-row" key={String(row.serviceId)}><span><strong>{row.serviceName}</strong><small>{plural(Number(row.appointments ?? 0), ["приём", "приёма", "приёмов"])} · вклад {formatCurrency(Number(row.contributionMargin ?? 0))}</small></span><Amount value={Number(row.revenue ?? 0)} /></div>)}</div> : <EmptyState title="Нет оплат по услугам" description="Данные появятся после завершённых и оплаченных приёмов." />}</SectionCard>
        <SectionCard title="По специалистам">{data.current.employeeRevenue.length ? <div className="simple-list">{data.current.employeeRevenue.map((row) => <div className="simple-list-row" key={String(row.employeeId)}><span><strong>{row.employeeName}</strong><small>{plural(Number(row.appointments ?? 0), ["приём", "приёма", "приёмов"])} · вклад {formatCurrency(Number(row.contributionMargin ?? 0))}</small></span><Amount value={Number(row.revenue ?? 0)} /></div>)}</div> : <EmptyState title="Нет оплат по специалистам" description="Данные появятся после завершённых и оплаченных приёмов." />}</SectionCard>
      </div>
    </> : null}
  </>;
}

export function KpiView() {
  const period = usePeriodPath("/api/kpi");
  const canExport = useCan("exports.read");
  const { data, loading, error, reload } = useApi<{ ok: true; items: KpiRow[] }>(period.path, undefined, { enabled: period.valid });
  return <>
    <PageHeader eyebrow="Команда" title="Эффективность специалистов" description="Операционная аналитика: выручка, время, повторные клиенты, возвраты и вклад в прибыль." actions={canExport ? <Button variant="secondary" onClick={() => { window.location.href = `/api/export?type=kpi&from=${period.from}&to=${period.to}`; }} disabled={!period.valid}><Download size={14} /> CSV KPI</Button> : undefined} />
    <PeriodToolbar period={period} />
    {loading && !data ? <LoadingState /> : null}{error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
    {data ? <SectionCard title="KPI команды" subtitle={plural(data.items.length, ["специалист", "специалиста", "специалистов"])}>{data.items.length ? <div className="table-wrap"><ResponsiveTable className="data-table"><thead><tr><th>Специалист</th><th>Приёмы</th><th>Выручка</th><th>Средний чек</th><th>Загрузка</th><th>Повторные</th><th>Вклад в прибыль</th><th>Неявки</th></tr></thead><tbody>{data.items.map((row) => <tr key={row.employeeId}><td><strong>{row.employeeName}</strong><small>{plural(row.freeMinutes, ["минута", "минуты", "минут"])} свободно</small></td><td>{row.completedAppointments}</td><td><Amount value={row.revenue} /></td><td><Amount value={row.averageCheck} /></td><td>{row.occupancy}%</td><td>{row.repeatBookingRate}% <small>{plural(row.returningClients, ["клиент", "клиента", "клиентов"])}</small></td><td><Amount value={row.contributionMargin} /></td><td>{row.noShows}</td></tr>)}</tbody></ResponsiveTable></div> : <EmptyState title="Нет данных за период" description="Показатели появятся после завершённых приёмов активных специалистов." />}</SectionCard> : null}
  </>;
}

export function GoalsView() {
  const canWrite = useCan("goals.write");
  const { data, loading, error, reload } = useApi<{ ok: true; items: GoalRow[] }>("/api/goals");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const defaults = useMemo(currentMonthRange, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    if (String(form.get("periodEnd")) < String(form.get("periodStart"))) { setFormError("Дата окончания раньше даты начала"); return; }
    setSaving(true); setFormError(null);
    try {
      await apiFetch("/api/goals", { method: "POST", body: { periodType: form.get("periodType"), periodStart: form.get("periodStart"), periodEnd: form.get("periodEnd"), metric: form.get("metric"), targetValue: Number(form.get("targetValue")) } });
      setOpen(false); dispatchCrmEvent("crm:data-changed");
    } catch (cause) { setFormError(errorText(cause, "Не удалось сохранить цель")); } finally { setSaving(false); }
  }
  const formatFact = (goal: GoalRow, value: number) => goal.metric === "CLIENTS" || goal.metric === "REPEAT_BOOKINGS" ? value.toLocaleString("ru-RU") : formatCurrency(value);
  return <>
    <PageHeader eyebrow="Планирование" title="План / факт" description="Цели центра и команды сравниваются с фактической выручкой и визитами текущего периода." actions={canWrite ? <Button onClick={() => { setFormError(null); setOpen(true); }}><Target size={15} /> Добавить цель</Button> : undefined} />
    {loading && !data ? <LoadingState /> : null}{error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
    {data ? <SectionCard title="Цели текущего периода" subtitle="Прогноз рассчитан по текущему темпу">{data.items.length ? <div className="simple-list">{data.items.map((goal) => { const percent = Math.max(0, Math.min(100, Number(goal.completionPercent) || 0)); return <div className="simple-list-row goal-row" key={goal.id}><span><strong>{metricLabels[goal.metric] ?? goal.metric}</strong><small>{formatDate(goal.periodStart)} — {formatDate(goal.periodEnd)} · факт {formatFact(goal, goal.fact)} · прогноз {formatFact(goal, goal.forecast)}</small><span className="goal-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={`Выполнение цели: ${percent}%`}><i style={{ width: `${percent}%` }} /></span></span><span><strong>{goal.completionPercent}%</strong><small>цель {formatFact(goal, goal.targetValue)}</small></span></div>; })}</div> : <EmptyState title="Целей на этот период нет" description="Добавьте цель по выручке, клиентам или среднему чеку, чтобы видеть прогресс." action={canWrite ? <Button onClick={() => { setFormError(null); setOpen(true); }}><Target size={14} /> Добавить цель</Button> : undefined} />}</SectionCard> : null}
    {open ? <Modal title="Новая цель" onClose={() => setOpen(false)} busy={saving} footer={<><Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>Отмена</Button><Button type="submit" form="goal-form" loading={saving}>{saving ? "Сохраняем…" : "Сохранить цель"}</Button></>}><form id="goal-form" className="form-grid" onSubmit={(event) => void create(event)}><FormField label="Период"><select name="periodType"><option value="MONTH">Месяц</option><option value="QUARTER">Квартал</option></select></FormField><FormField label="Метрика"><select name="metric">{Object.entries(metricLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField><FormField label="Начало"><input name="periodStart" type="date" required defaultValue={defaults.from} /></FormField><FormField label="Конец" hint="Включительно"><input name="periodEnd" type="date" required defaultValue={defaults.to} /></FormField><FormField label="Цель" className="form-field-wide" hint="Сумма в тенге или количество, в зависимости от метрики"><input name="targetValue" type="number" min="0.01" step="0.01" inputMode="decimal" required /></FormField>{formError ? <div className="form-field-wide"><InlineError>{formError}</InlineError></div> : null}</form></Modal> : null}
  </>;
}

export function RetentionView() {
  const canWrite = useCan("retention.write");
  const [selected, setSelected] = useState("");
  const { data, loading, error, reload } = useApi<{ ok: true; segments: RetentionSegment[]; clients: RetentionClient[] }>(`/api/retention${selected ? `?segment=${encodeURIComponent(selected)}` : ""}`);
  const followUps = useApi<{ ok: true; items: Array<{ id: string; clientName: string; recommendedDate: string; status: string }> }>("/api/follow-ups");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  async function createFollowUp(client: RetentionClient) {
    if (pendingId) return;
    setPendingId(client.id); setNotice(null);
    try {
      await apiFetch("/api/follow-ups", { method: "POST", body: { clientId: client.id, intervalDays: 30 } });
      setNotice({ tone: "success", text: `Повторный визит для ${client.fullName} запланирован через 30 дней.` });
      void followUps.reload(); dispatchCrmEvent("crm:data-changed");
    } catch (cause) { setNotice({ tone: "error", text: errorText(cause, "Не удалось создать напоминание") }); } finally { setPendingId(null); }
  }
  const selectedSegment = data?.segments.find((segment) => segment.id === selected);
  return <>
    <PageHeader eyebrow="Клиенты" title="Удержание клиентов" description="Сегменты строятся по истории посещений, оплат, отмен и давности последнего визита. Медицинских данных здесь нет." />
    {notice ? <p className={`notice ${notice.tone === "error" ? "notice-error" : "notice-success"}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p> : null}
    {loading && !data ? <LoadingState /> : null}{error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
    {data ? <>
      <div className="segment-grid" role="group" aria-label="Сегменты клиентов">{data.segments.map((segment) => <button type="button" key={segment.id} className={`segment-card ${selected === segment.id ? "segment-card-active" : ""}`} aria-pressed={selected === segment.id} onClick={() => setSelected(selected === segment.id ? "" : segment.id)}><strong>{segment.name}</strong><span>{plural(segment.count, ["клиент", "клиента", "клиентов"])}</span><small>{segment.description}</small></button>)}</div>
      <SectionCard title={selectedSegment ? `Сегмент «${selectedSegment.name}»` : "Все клиенты"} subtitle={plural(data.clients.length, ["клиент", "клиента", "клиентов"])}>{data.clients.length ? <div className="table-wrap"><ResponsiveTable className="data-table"><thead><tr><th>Клиент</th><th>Визиты</th><th>Выручка</th><th>Средний чек</th><th>Последний визит</th>{canWrite ? <th><span className="visually-hidden">Действия</span></th> : null}</tr></thead><tbody>{data.clients.map((client) => <tr key={client.id}><td><strong>{client.fullName}</strong><small>{client.phone}</small></td><td>{client.visits}</td><td><Amount value={client.revenue} /></td><td><Amount value={client.averageCheck} /></td><td>{client.lastVisit ? formatDate(client.lastVisit) : "Нет визитов"}</td>{canWrite ? <td><Button variant="ghost" loading={pendingId === client.id} disabled={Boolean(pendingId)} onClick={() => void createFollowUp(client)}>Повторный визит</Button></td> : null}</tr>)}</tbody></ResponsiveTable></div> : <EmptyState title="В сегменте пока нет клиентов" description="Сегмент заполнится, когда появятся подходящие по истории визитов клиенты." />}</SectionCard>
    </> : null}
    <SectionCard title="Ближайшие повторные визиты" subtitle="Открытые напоминания администратору">{followUps.loading && !followUps.data ? <LoadingState label="Загружаем напоминания…" /> : followUps.data?.items.length ? <div className="simple-list">{followUps.data.items.map((item) => <div className="simple-list-row" key={item.id}><span><strong>{item.clientName}</strong><small>{formatDate(item.recommendedDate)}</small></span><StatusPill status={item.status.toLowerCase()} /></div>)}</div> : <EmptyState title="Напоминаний нет" description="Напоминания появляются после завершения приёма или кнопкой «Повторный визит»." />}</SectionCard>
  </>;
}

export function TasksView() {
  const canWrite = useCan("tasks.write");
  const { data, loading, error, reload } = useApi<{ ok: true; items: TaskRow[] }>("/api/tasks");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const defaultDue = useMemo(() => `${dateInputValue(new Date(Date.now() + 86_400_000)).slice(0, 10)}T10:00`, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setFormError(null);
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch("/api/tasks", { method: "POST", body: { title: form.get("title"), description: form.get("description"), dueDate: form.get("dueDate"), priority: form.get("priority") } });
      setOpen(false); dispatchCrmEvent("crm:data-changed");
    } catch (cause) { setFormError(errorText(cause, "Не удалось создать задачу")); } finally { setSaving(false); }
  }
  async function toggle(task: TaskRow) {
    if (pendingId) return;
    setPendingId(task.id); setActionError(null);
    try {
      await apiFetch(`/api/tasks/${task.id}`, { method: "PATCH", body: { status: task.status === "DONE" ? "OPEN" : "DONE" } });
      dispatchCrmEvent("crm:data-changed");
    } catch (cause) { setActionError(errorText(cause, "Не удалось обновить задачу")); } finally { setPendingId(null); }
  }
  const items = data?.items ?? [];
  const openCount = items.filter((task) => task.status !== "DONE" && task.status !== "CANCELLED").length;
  return <>
    <PageHeader eyebrow="Команда" title="Задачи" description="Операционные задачи команды: звонки, подтверждения, закупки и контроль оплат." actions={canWrite ? <Button onClick={() => { setFormError(null); setOpen(true); }}><Plus size={15} /> Новая задача</Button> : undefined} />
    {actionError ? <InlineError>{actionError}</InlineError> : null}
    {loading && !data ? <LoadingState /> : null}{error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
    {data ? <SectionCard title="Мои и командные задачи" subtitle={openCount ? `${plural(openCount, ["открытая задача", "открытые задачи", "открытых задач"])}` : "Все задачи закрыты"}>{items.length ? <div className="simple-list">{items.map((task) => { const overdue = task.dueDate && task.status !== "DONE" && task.status !== "CANCELLED" && new Date(task.dueDate).getTime() < Date.now(); return <div className={`simple-list-row ${task.status === "DONE" ? "simple-list-row-done" : ""}`} key={task.id}><span><strong>{task.title}</strong><small>{[task.clientName ?? "Без клиента", task.dueDate ? `срок ${formatDateTime(task.dueDate)}` : "без срока", task.assigneeName ?? "не назначена", task.priority !== "NORMAL" ? (priorityLabels[task.priority] ?? task.priority) : null].filter(Boolean).join(" · ")}{overdue ? <b className="danger-text"> · просрочена</b> : null}</small></span><span className="row-actions"><StatusPill status={task.status.toLowerCase()} />{canWrite ? <Button variant="ghost" loading={pendingId === task.id} disabled={Boolean(pendingId)} onClick={() => void toggle(task)} aria-label={task.status === "DONE" ? `Открыть снова: ${task.title}` : `Выполнено: ${task.title}`}>{task.status === "DONE" ? "Открыть" : <Check size={14} />}</Button> : null}</span></div>; })}</div> : <EmptyState title="Задач пока нет" description="Создайте первую задачу: напоминание о звонке, подтверждении или закупке." action={canWrite ? <Button onClick={() => { setFormError(null); setOpen(true); }}><Plus size={14} /> Новая задача</Button> : undefined} />}</SectionCard> : null}
    {open ? <Modal title="Новая задача" onClose={() => setOpen(false)} busy={saving} footer={<><Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>Отмена</Button><Button type="submit" form="task-form" loading={saving}>{saving ? "Сохраняем…" : "Создать задачу"}</Button></>}><form id="task-form" className="form-grid" onSubmit={(event) => void create(event)}><FormField label="Название" className="form-field-wide"><input name="title" required maxLength={200} autoFocus /></FormField><FormField label="Описание" className="form-field-wide"><textarea name="description" maxLength={2000} rows={3} /></FormField><FormField label="Срок" hint="Время центра (Алматы)"><input name="dueDate" type="datetime-local" defaultValue={defaultDue} /></FormField><FormField label="Приоритет"><select name="priority" defaultValue="NORMAL">{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>{formError ? <div className="form-field-wide"><InlineError>{formError}</InlineError></div> : null}</form></Modal> : null}
  </>;
}

export function CampaignsView() {
  const canWrite = useCan("campaigns.write");
  const { data, loading, error, reload } = useApi<{ ok: true; items: CampaignRow[] }>("/api/campaigns");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sendTarget, setSendTarget] = useState<CampaignRow | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setFormError(null);
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch("/api/campaigns", { method: "POST", body: { name: form.get("name"), message: form.get("message") } });
      setOpen(false); dispatchCrmEvent("crm:data-changed");
    } catch (cause) { setFormError(errorText(cause, "Не удалось сохранить кампанию")); } finally { setSaving(false); }
  }
  async function send() {
    if (!sendTarget || sending) return;
    setSending(true); setSendError(null);
    try {
      const result = await apiFetch<{ ok: true; recipientCount: number }>(`/api/campaigns/${sendTarget.id}/send`, { method: "POST", body: {} });
      setNotice(`Кампания «${sendTarget.name}» поставлена в очередь: ${plural(result.recipientCount, ["получатель", "получателя", "получателей"])}. Доставка займёт несколько минут.`);
      setSendTarget(null); dispatchCrmEvent("crm:data-changed");
    } catch (cause) { setSendError(errorText(cause, "Не удалось запустить кампанию")); } finally { setSending(false); }
  }
  return <>
    <PageHeader eyebrow="Маркетинг" title="Telegram-кампании" description="Сообщения получают только клиенты, согласившиеся на рассылки. Доставка идёт через очередь с повторами и защитой от дублей." actions={canWrite ? <Button onClick={() => { setFormError(null); setOpen(true); }}><Plus size={15} /> Новая кампания</Button> : undefined} />
    {notice ? <p className="notice notice-success" role="status">{notice}</p> : null}
    {loading && !data ? <LoadingState /> : null}{error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
    {data ? <SectionCard title="Кампании" subtitle={plural(data.items.length, ["кампания", "кампании", "кампаний"])}>{data.items.length ? <div className="simple-list">{data.items.map((campaign) => <div className="simple-list-row" key={campaign.id}><span><strong>{campaign.name}</strong><small>{plural(campaign.recipientCount, ["получатель", "получателя", "получателей"])} · отправлено {campaign.sentCount} · ошибок {campaign.errorCount}</small></span><span className="row-actions"><StatusPill status={campaign.status.toLowerCase()} />{canWrite && ["DRAFT", "SCHEDULED"].includes(campaign.status) ? <Button variant="ghost" onClick={() => { setSendError(null); setSendTarget(campaign); }}><Send size={14} /> Запустить</Button> : null}</span></div>)}</div> : <EmptyState title="Кампаний пока нет" description="Создайте сообщение об акции или напоминание — оно уйдёт клиентам с согласием на рассылку." action={canWrite ? <Button onClick={() => { setFormError(null); setOpen(true); }}><Plus size={14} /> Новая кампания</Button> : undefined} />}</SectionCard> : null}
    {open ? <Modal title="Новая кампания" onClose={() => setOpen(false)} busy={saving} footer={<><Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>Отмена</Button><Button type="submit" form="campaign-form" loading={saving}>{saving ? "Сохраняем…" : "Сохранить кампанию"}</Button></>}><form id="campaign-form" className="form-grid" onSubmit={(event) => void create(event)}><FormField label="Название" className="form-field-wide"><input name="name" required maxLength={200} autoFocus /></FormField><FormField label="Текст сообщения" className="form-field-wide" hint="До 3 800 символов. Подстановки: {clientName}, {date}, {time}, {specialist}, {service}, {branch}"><textarea name="message" required rows={6} maxLength={3800} /></FormField>{formError ? <div className="form-field-wide"><InlineError>{formError}</InlineError></div> : null}</form></Modal> : null}
    {sendTarget ? <ConfirmDialog title="Запустить рассылку?" description={`«${sendTarget.name}» будет отправлена всем активным клиентам с согласием на рассылки. Остановить отправку после запуска нельзя.`} confirmLabel="Запустить" pending={sending} error={sendError} onConfirm={() => void send()} onClose={() => { if (!sending) setSendTarget(null); }}><blockquote className="campaign-preview">{sendTarget.message}</blockquote></ConfirmDialog> : null}
  </>;
}

export function PurchasesView() {
  const canWrite = useCan("purchases.write");
  const { data, loading, error, reload } = useApi<{ ok: true; items: PurchaseRow[] }>("/api/purchases");
  const { data: products } = useApi<{ ok: true; items: InventoryItem[] }>("/api/inventory", undefined, { enabled: canWrite });
  const { data: branches } = useApi<{ ok: true; branches: BranchItem[] }>("/api/settings", undefined, { enabled: canWrite });
  const { data: suppliers } = useApi<{ ok: true; items: SupplierRow[] }>("/api/inventory/suppliers", undefined, { enabled: canWrite });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [receiveTarget, setReceiveTarget] = useState<{ purchase: PurchaseRow; items: PurchaseItem[] } | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setFormError(null);
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch("/api/purchases", { method: "POST", body: { branchId: form.get("branchId"), supplierId: form.get("supplierId") || null, items: [{ productId: form.get("productId"), quantity: Number(form.get("quantity")), unitCost: Number(form.get("unitCost")) }] } });
      setOpen(false); dispatchCrmEvent("crm:data-changed");
    } catch (cause) { setFormError(errorText(cause, "Не удалось создать закупку")); } finally { setSaving(false); }
  }
  async function order(purchase: PurchaseRow) {
    if (loadingId) return;
    setLoadingId(purchase.id); setNotice(null);
    try {
      await apiFetch(`/api/purchases/${purchase.id}`, { method: "PATCH", body: { status: "ORDERED" } });
      setNotice({ tone: "success", text: "Закупка переведена в статус «Заказана». Когда товар придёт, нажмите «Принять»." });
      dispatchCrmEvent("crm:data-changed");
    } catch (cause) { setNotice({ tone: "error", text: errorText(cause, "Не удалось изменить статус закупки") }); } finally { setLoadingId(null); }
  }
  async function prepareReceive(purchase: PurchaseRow) {
    if (loadingId) return;
    setLoadingId(purchase.id); setNotice(null); setReceiveError(null);
    try {
      const detail = await apiFetch<{ ok: true; items: PurchaseItem[] }>(`/api/purchases/${purchase.id}`);
      const pending = detail.items.filter((item) => Number(item.orderedQuantity) > Number(item.receivedQuantity));
      if (!pending.length) { setNotice({ tone: "error", text: "По этой закупке всё уже принято." }); return; }
      setReceiveTarget({ purchase, items: pending });
    } catch (cause) { setNotice({ tone: "error", text: errorText(cause, "Не удалось загрузить закупку") }); } finally { setLoadingId(null); }
  }
  async function receive() {
    if (!receiveTarget || receiving) return;
    setReceiving(true); setReceiveError(null);
    const items = receiveTarget.items.map((item) => ({ purchaseItemId: item.id, quantity: Number(item.orderedQuantity) - Number(item.receivedQuantity), unitCost: Number(item.unitCost) }));
    try {
      await apiFetch(`/api/purchases/${receiveTarget.purchase.id}/receive`, { method: "POST", body: { items, idempotencyKey: crypto.randomUUID() } });
      setNotice({ tone: "success", text: `Поставка принята: ${plural(items.length, ["позиция", "позиции", "позиций"])} оприходованы на склад.` });
      setReceiveTarget(null); dispatchCrmEvent("crm:data-changed");
    } catch (cause) { setReceiveError(errorText(cause, "Не удалось принять поставку")); } finally { setReceiving(false); }
  }
  const activeBranches = branches?.branches?.filter((branch) => branch.isActive) ?? [];
  return <>
    <PageHeader eyebrow="Операции / склад" title="Закупки" description="Заказ, частичная поставка и приём товара создают связанные движения склада." actions={canWrite ? <Button onClick={() => { setFormError(null); setOpen(true); }} disabled={!products?.items.length}><ShoppingCart size={15} /> Новая закупка</Button> : undefined} />
    {notice ? <p className={`notice ${notice.tone === "error" ? "notice-error" : "notice-success"}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p> : null}
    {loading && !data ? <LoadingState /> : null}{error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
    {data ? <SectionCard title="История закупок" subtitle={plural(data.items.length, ["закупка", "закупки", "закупок"])}>{data.items.length ? <div className="table-wrap"><ResponsiveTable className="data-table"><thead><tr><th>Дата</th><th>Поставщик</th><th>Филиал</th><th>Позиции</th><th>Сумма</th><th>Статус</th>{canWrite ? <th><span className="visually-hidden">Действия</span></th> : null}</tr></thead><tbody>{data.items.map((purchase) => <tr key={purchase.id}><td>{formatDate(purchase.orderDate)}</td><td>{purchase.supplierName ?? "—"}</td><td>{purchase.branchName}</td><td>{purchase.itemCount}</td><td><Amount value={Number(purchase.totalAmount ?? 0)} /></td><td><StatusPill status={purchase.status.toLowerCase()} /></td>{canWrite ? <td>{["ORDERED", "PARTIALLY_RECEIVED"].includes(purchase.status) ? <Button variant="ghost" loading={loadingId === purchase.id} disabled={Boolean(loadingId)} onClick={() => void prepareReceive(purchase)}><PackagePlus size={14} /> Принять</Button> : purchase.status === "DRAFT" ? <Button variant="ghost" loading={loadingId === purchase.id} disabled={Boolean(loadingId)} onClick={() => void order(purchase)}><ShoppingCart size={14} /> Заказать</Button> : null}</td> : null}</tr>)}</tbody></ResponsiveTable></div> : <EmptyState title="Закупок пока нет" description="Создайте первую закупку: товар попадёт на склад после приёма поставки." action={canWrite && products?.items.length ? <Button onClick={() => { setFormError(null); setOpen(true); }}><ShoppingCart size={14} /> Новая закупка</Button> : undefined} />}</SectionCard> : null}
    {open ? <Modal title="Новая закупка" onClose={() => setOpen(false)} busy={saving} footer={<><Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>Отмена</Button><Button type="submit" form="purchase-form" loading={saving}>{saving ? "Сохраняем…" : "Создать закупку"}</Button></>}><form id="purchase-form" className="form-grid" onSubmit={(event) => void create(event)}><FormField label="Филиал"><select name="branchId" required>{activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></FormField><FormField label="Поставщик"><select name="supplierId" defaultValue=""><option value="">Не выбран</option>{suppliers?.items.filter((supplier) => supplier.isActive).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></FormField><FormField label="Товар"><select name="productId" required>{products?.items.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></FormField><FormField label="Количество"><input name="quantity" type="number" min="0.001" step="0.001" inputMode="decimal" required /></FormField><FormField label="Закупочная цена, ₸"><input name="unitCost" type="number" min="0" step="0.01" inputMode="decimal" required /></FormField><p className="modal-intro form-field-wide">Закупка создаётся как черновик. Переведите её в статус «Заказана», затем примите поставку — остаток обновится автоматически.</p>{formError ? <div className="form-field-wide"><InlineError>{formError}</InlineError></div> : null}</form></Modal> : null}
    {receiveTarget ? <ConfirmDialog title="Принять поставку?" description={`${receiveTarget.purchase.supplierName ?? "Поставщик не указан"} · ${receiveTarget.purchase.branchName}. Остаток по позициям ниже увеличится, движение попадёт в журнал склада.`} confirmLabel="Принять на склад" pending={receiving} error={receiveError} onConfirm={() => void receive()} onClose={() => { if (!receiving) setReceiveTarget(null); }}><div className="simple-list">{receiveTarget.items.map((item) => <div className="simple-list-row" key={item.id}><span><strong>{item.productName ?? "Товар"}</strong><small>{formatCurrency(Number(item.unitCost || 0))} за {item.unit ?? "ед."}</small></span><strong>{(Number(item.orderedQuantity) - Number(item.receivedQuantity)).toLocaleString("ru-RU")} {item.unit ?? ""}</strong></div>)}</div></ConfirmDialog> : null}
  </>;
}

export function SuppliersView() {
  const canWrite = useCan("inventory.write");
  const { data, loading, error, reload } = useApi<{ ok: true; items: SupplierRow[] }>("/api/inventory/suppliers");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setFormError(null);
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch("/api/inventory/suppliers", { method: "POST", body: { name: form.get("name"), contactName: form.get("contactName"), phone: form.get("phone"), telegram: form.get("telegram"), whatsapp: form.get("whatsapp"), email: form.get("email"), notes: form.get("notes") } });
      setOpen(false); dispatchCrmEvent("crm:data-changed"); await reload();
    } catch (cause) { setFormError(errorText(cause, "Не удалось создать поставщика")); } finally { setSaving(false); }
  }
  return <>
    <PageHeader eyebrow="Операции / склад" title="Поставщики" description="Контакты поставщиков связаны с товарами и закупками." actions={canWrite ? <Button onClick={() => { setFormError(null); setOpen(true); }}><Plus size={15} /> Новый поставщик</Button> : undefined} />
    {loading && !data ? <LoadingState /> : null}{error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
    {data ? <SectionCard title="Справочник поставщиков" subtitle={plural(data.items.length, ["поставщик", "поставщика", "поставщиков"])}>{data.items.length ? <div className="simple-list">{data.items.map((supplier) => <div className="simple-list-row" key={supplier.id}><span><strong>{supplier.name}</strong><small>{supplier.contactName ?? "Контакт не указан"} · {supplier.phone ?? supplier.email ?? "Нет контактов"}</small></span><span className="row-actions">{supplier.telegram ? <small>Telegram</small> : null}{supplier.whatsapp ? <small>WhatsApp</small> : null}<StatusPill status={supplier.isActive ? "active" : "archived"} /></span></div>)}</div> : <EmptyState title="Поставщиков пока нет" description="Добавьте первого поставщика, чтобы связать его с товарами и закупками." action={canWrite ? <Button onClick={() => { setFormError(null); setOpen(true); }}><Plus size={14} /> Добавить</Button> : undefined} />}</SectionCard> : null}
    {open ? <Modal title="Новый поставщик" onClose={() => setOpen(false)} busy={saving} footer={<><Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>Отмена</Button><Button type="submit" form="supplier-form" loading={saving}>{saving ? "Сохраняем…" : "Создать поставщика"}</Button></>}><form id="supplier-form" className="form-grid" onSubmit={(event) => void create(event)}><FormField label="Название" className="form-field-wide"><input name="name" required maxLength={200} autoFocus /></FormField><FormField label="Контактное лицо"><input name="contactName" maxLength={200} /></FormField><FormField label="Телефон"><input name="phone" type="tel" maxLength={32} inputMode="tel" /></FormField><FormField label="Telegram"><input name="telegram" maxLength={64} placeholder="@username" /></FormField><FormField label="WhatsApp"><input name="whatsapp" maxLength={32} inputMode="tel" /></FormField><FormField label="Email"><input name="email" type="email" maxLength={200} /></FormField><FormField label="Комментарий" className="form-field-wide"><textarea name="notes" maxLength={2000} rows={3} /></FormField>{formError ? <div className="form-field-wide"><InlineError>{formError}</InlineError></div> : null}</form></Modal> : null}
  </>;
}
