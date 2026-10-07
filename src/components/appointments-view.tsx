"use client";

import { ResponsiveTable } from "@/components/responsive-table";

import { FormEvent, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Check, Download, Play, Plus, QrCode, ScanLine, Search, UserCheck, XCircle } from "lucide-react";

import { apiFetch, dispatchCrmEvent } from "@/lib/api-client";
import { AuthHint, ConfirmDialog, EmptyState, ErrorState, FormField, InlineError, isAuthError, LoadingState, Modal } from "@/components/data-state";
import { Amount, Avatar, Button, PageHeader, SectionCard, StatusPill } from "@/components/ui";
import type { AppointmentRecord, AppointmentsResponse, Branch, ClientRecord, EmployeeRecord, ServiceRecord } from "@/lib/crm-types";
import { CENTRE_TIMEZONE, dateInputValue, dateValueInZone, formatDateTime, initials, insideTelegram, plural } from "@/lib/format";
import { localDayRange } from "@/lib/appointments/schedule";
import { useApi } from "@/lib/use-api";
import { useOperationKey } from "@/lib/use-operation-key";
import { PhoneInput } from "@/components/phone-input";

type CatalogResponse = { branches: Branch[]; employees: EmployeeRecord[]; clients: ClientRecord[]; services: ServiceRecord[] };
type CancelTarget = { appointment: AppointmentRecord; status: "CANCELLED" | "NO_SHOW" };

function statusKey(status: string) {
  return status.toLowerCase();
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function AppointmentsView() {
  const bookingKey = useOperationKey();
  const paymentKey = useOperationKey();
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [checkInCode, setCheckInCode] = useState("");
  const [checkInMessage, setCheckInMessage] = useState<string | null>(null);
  const [checkInSaving, setCheckInSaving] = useState(false);
  const [paymentAppointment, setPaymentAppointment] = useState<AppointmentRecord | null>(null);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [followUpAppointment, setFollowUpAppointment] = useState<AppointmentRecord | null>(null);
  const [followUpDays, setFollowUpDays] = useState("30");
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [calendarView, setCalendarView] = useState<"today" | "day" | "week">("today");
  const [selectedDate, setSelectedDate] = useState(() => dateValueInZone(new Date()));
  const [branchFilter, setBranchFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [newClient, setNewClient] = useState(false);
  const [canPrint, setCanPrint] = useState(false);
  const deferredQuery = useDeferredValue(query);
  useEffect(() => { setCanPrint(!insideTelegram()); }, []);
  // The day/week window is the centre's calendar day, whatever the browser timezone is.
  const calendarRange = useMemo(() => {
    const day = calendarView === "today" ? dateValueInZone(new Date()) : selectedDate;
    if (calendarView === "week") {
      const weekday = new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
      const monday = shiftDate(day, 1 - weekday);
      return { from: localDayRange(monday, CENTRE_TIMEZONE).from, to: localDayRange(shiftDate(monday, 6), CENTRE_TIMEZONE).to };
    }
    const range = localDayRange(day, CENTRE_TIMEZONE);
    return { from: range.from, to: range.to };
  }, [calendarView, selectedDate]);
  const appointmentParams = new URLSearchParams({ from: calendarRange.from, to: calendarRange.to, pageSize: "200" });
  if (deferredQuery.trim()) appointmentParams.set("q", deferredQuery.trim());
  if (branchFilter) appointmentParams.set("branchId", branchFilter);
  if (employeeFilter) appointmentParams.set("employeeId", employeeFilter);
  if (statusFilter) appointmentParams.set("status", statusFilter);
  const path = `/api/appointments?${appointmentParams.toString()}`;
  const { data, loading, error, reload } = useApi<AppointmentsResponse>(path);
  const { data: catalog } = useApi<CatalogResponse>("/api/appointment-catalog");
  const branches = catalog?.branches ?? [];
  const employees = catalog?.employees ?? [];
  const catalogClients = catalog?.clients;
  const clients = useMemo(() => catalogClients ?? [], [catalogClients]);
  const services = catalog?.services ?? [];
  const items = data?.items ?? [];
  const completed = items.filter((item) => statusKey(item.status) === "completed").length;
  const expected = items.filter((item) => !["cancelled", "no_show"].includes(statusKey(item.status))).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const visibleClients = useMemo(() => {
    const needle = clientSearch.trim().toLowerCase().replace(/\s+/g, "");
    const active = clients.filter((client) => client.isActive !== 0);
    if (!needle) return active;
    return active.filter((client) => client.fullName.toLowerCase().replace(/\s+/g, "").includes(needle) || client.phone.replace(/\D/g, "").includes(needle.replace(/\D/g, "") || "\u0000"));
  }, [clients, clientSearch]);

  async function createAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    const values = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    if (newClient) delete values.clientId; else { delete values.clientName; delete values.clientPhone; }
    try {
      await apiFetch("/api/appointments", { method: "POST", body: { ...values, idempotencyKey: bookingKey.get(values) } });
      bookingKey.reset();
      setModalOpen(false);
      setNewClient(false);
      setClientSearch("");
      setNotice("Запись создана");
      dispatchCrmEvent("crm:data-changed");
      await reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Не удалось создать запись");
    } finally {
      setSaving(false);
    }
  }

  async function patchAppointment(appointment: AppointmentRecord, body: Record<string, unknown>, failure: string, success?: string) {
    if (updatingId) return false;
    setUpdatingId(appointment.id);
    setFormError(null);
    try {
      const result = await apiFetch<{ inventoryWarnings?: { message: string }[] }>(`/api/appointments/${appointment.id}`, { method: "PATCH", body: { ...body, revision: appointment.revision } });
      setNotice(result.inventoryWarnings?.length ? result.inventoryWarnings.map((warning) => warning.message).join(" ") : success ?? "Изменения сохранены");
      dispatchCrmEvent("crm:data-changed");
      await reload();
      return true;
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : failure);
      await reload();
      return false;
    } finally {
      setUpdatingId(null);
    }
  }

  async function completeAppointment(appointment: AppointmentRecord, recommendedDays: number | null) {
    const done = await patchAppointment(appointment, { status: "COMPLETED", ...(recommendedDays ? { followUpDays: recommendedDays } : {}) }, "Не удалось завершить приём", "Приём завершён");
    if (done) setFollowUpAppointment(null);
  }

  async function confirmCancellation() {
    if (!cancelTarget) return;
    const reason = cancelReason.trim() || (cancelTarget.status === "NO_SHOW" ? "Клиент не пришёл" : "Отменено администратором");
    const done = await patchAppointment(cancelTarget.appointment, { status: cancelTarget.status, cancelReason: reason }, "Не удалось изменить статус записи", cancelTarget.status === "NO_SHOW" ? "Неявка отмечена" : "Запись отменена");
    if (done) { setCancelTarget(null); setCancelReason(""); }
  }

  async function showAppointmentCode(id: string) {
    setCheckInMessage(null);
    setCheckInCode("");
    setCheckInOpen(true);
    try {
      const response = await apiFetch<{ ok: true; checkInToken: string }>("/api/checkin", { method: "POST", body: { appointmentId: id } });
      setCheckInCode(response.checkInToken);
    } catch (cause) {
      setCheckInMessage(cause instanceof Error ? cause.message : "Не удалось получить код");
    }
  }

  async function createPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paymentAppointment || paymentSaving) return;
    setPaymentSaving(true);
    setFormError(null);
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget).entries());
      const body = { ...values, appointmentId: paymentAppointment.id };
      await apiFetch("/api/payments", { method: "POST", body: { ...body, idempotencyKey: paymentKey.get(body) } });
      paymentKey.reset();
      setPaymentAppointment(null);
      setNotice("Оплата проведена");
      dispatchCrmEvent("crm:data-changed");
      await reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Не удалось принять оплату");
    } finally {
      setPaymentSaving(false);
    }
  }

  async function submitCheckIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCheckInSaving(true);
    setCheckInMessage(null);
    try {
      const response = await apiFetch<{ ok: true; appointment: { clientName: string } }>("/api/checkin", { method: "POST", body: { token: checkInCode } });
      setCheckInMessage(`Готово: ${response.appointment.clientName} отмечен(а) как пришедший.`);
      dispatchCrmEvent("crm:data-changed");
      await reload();
    } catch (cause) {
      setCheckInMessage(cause instanceof Error ? cause.message : "Не удалось отметить приход");
    } finally {
      setCheckInSaving(false);
    }
  }

  function scanQr() {
    const webApp = window.Telegram?.WebApp;
    if (!webApp?.showScanQrPopup) {
      setCheckInMessage("Сканирование QR доступно при открытии CRM внутри Telegram. Можно ввести код вручную.");
      return;
    }
    webApp.showScanQrPopup({ text: "Наведите камеру на QR-код клиента" }, (value) => {
      try {
        const parsed = new URL(value);
        setCheckInCode(parsed.searchParams.get("token") ?? value);
      } catch {
        setCheckInCode(value);
      }
      webApp.closeScanQrPopup?.();
      return true;
    });
  }

  const paymentBalance = paymentAppointment ? Math.max(0, Number(paymentAppointment.balance ?? Number(paymentAppointment.amount || 0) - Number(paymentAppointment.paidAmount || 0))) : 0;
  const catalogTruncated = clients.length >= 200;

  return (
    <>
      <PageHeader
        eyebrow="Рабочий стол"
        title="Записи"
        description="Календарь приёмов, статусы клиентов и загрузка специалистов."
        actions={<><Button variant="secondary" onClick={() => { setCheckInCode(""); setCheckInMessage(null); setCheckInOpen(true); }}><ScanLine size={15} /> Отметить приход</Button>{canPrint ? <Button variant="secondary" onClick={() => window.print()}><Download size={15} /> Печать</Button> : null}<Button onClick={() => { setFormError(null); setModalOpen(true); }}><Plus size={16} /> Новая запись</Button></>}
      />

      {loading && !data ? <LoadingState /> : null}
      {error && isAuthError(error) ? <AuthHint /> : null}
      {error && !isAuthError(error) && !data ? <ErrorState message={error} onRetry={reload} /> : null}
      {notice ? <p className="client-notice" role="status">{notice}</p> : null}
      {formError && !modalOpen && !paymentAppointment && !followUpAppointment && !cancelTarget ? <InlineError>{formError}</InlineError> : null}

      {data ? <>
        <div className="stat-strip">
          <div className="small-stat"><span>Записей за период</span><strong>{items.length}</strong></div>
          <div className="small-stat"><span>Завершено</span><strong>{completed}</strong></div>
          <div className="small-stat"><span>Сумма без отмен</span><strong className="small-stat-label">{expected.toLocaleString("ru-RU")} ₸</strong></div>
        </div>

        <div className="filter-bar calendar-toolbar">
          <label className="filter-select search-input"><span>Поиск записи</span><span className="search-input-control"><Search size={15} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя или телефон" maxLength={100} /></span></label>
          <label className="filter-select"><span>Период</span><select value={calendarView} onChange={(event) => setCalendarView(event.target.value as "today" | "day" | "week")}><option value="today">Сегодня</option><option value="day">День</option><option value="week">Неделя</option></select></label>
          <label className="filter-select"><span>Дата</span><input type="date" value={selectedDate} disabled={calendarView === "today"} onChange={(event) => { if (event.target.value) setSelectedDate(event.target.value); }} /></label>
          <label className="filter-select"><span>Филиал</span><select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}><option value="">Все филиалы</option>{branches.filter((branch) => branch.isActive).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          {employees.length > 1 ? <label className="filter-select"><span>Специалист</span><select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}><option value="">Все специалисты</option>{employees.filter((employee) => employee.isActive).map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}</option>)}</select></label> : null}
          <label className="filter-select"><span>Статус</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Все статусы</option><option value="SCHEDULED">Запланирован</option><option value="CONFIRMED">Подтверждён</option><option value="ARRIVED">Пришёл</option><option value="IN_PROGRESS">В работе</option><option value="COMPLETED">Завершён</option><option value="CANCELLED">Отменён</option><option value="NO_SHOW">Неявка</option></select></label>
          <div className="filter-spacer" />
          <span className="table-secondary">{deferredQuery ? `Результаты для «${deferredQuery}»` : plural(items.length, ["запись", "записи", "записей"])}</span>
        </div>

        <SectionCard title="Расписание" subtitle={calendarView === "week" ? "Неделя по часовому поясу центра" : "День по часовому поясу центра"}>
          {items.length === 0 ? <EmptyState title={deferredQuery || statusFilter || branchFilter || employeeFilter ? "По выбранным фильтрам записей нет" : "Записей на этот период нет"} description={deferredQuery || statusFilter || branchFilter || employeeFilter ? "Измените фильтры или период, чтобы увидеть другие приёмы." : "Добавьте приём — клиент автоматически появится в базе."} action={<Button onClick={() => setModalOpen(true)}><Plus size={15} /> Добавить запись</Button>} /> : (
            <div className="table-wrap">
              <ResponsiveTable className="data-table">
                <thead><tr><th>Дата и время</th><th>Клиент</th><th>Специалист</th><th>Филиал</th><th>Статус</th><th>Сумма</th><th><span className="visually-hidden">Действия</span></th></tr></thead>
                <tbody>{items.map((appointment, index) => {
                  const currentStatus = statusKey(appointment.status);
                  const busy = updatingId === appointment.id;
                  const balance = Number(appointment.balance ?? Number(appointment.amount || 0) - Number(appointment.paidAmount || 0));
                  return <tr key={appointment.id}>
                    <td><span className="table-time">{formatDateTime(appointment.startsAt)}</span></td>
                    <td><div className="client-cell"><Avatar initials={initials(appointment.clientName)} tone={index % 3 === 0 ? "violet" : index % 3 === 1 ? "blue" : "peach"} /><div><strong>{appointment.clientName}</strong><span>{appointment.clientPhone}</span></div></div></td>
                    <td>{appointment.employeeName ?? "Не назначен"}<span className="table-secondary">{appointment.serviceName ?? "Услуга не указана"}</span></td>
                    <td>{appointment.branchName ?? "Без филиала"}</td>
                    <td><StatusPill status={currentStatus} />{appointment.cancelReason && ["cancelled", "no_show"].includes(currentStatus) ? <span className="table-secondary">{appointment.cancelReason}</span> : null}</td>
                    <td><Amount value={Number(appointment.amount || 0)} /><span className="table-secondary">Оплачено {Number(appointment.paidAmount || 0).toLocaleString("ru-RU")} ₸</span></td>
                    <td><div className="appointment-actions">{!["cancelled", "no_show", "completed"].includes(currentStatus) ? <>
                      <button type="button" className="inline-action" onClick={() => void showAppointmentCode(appointment.id)} disabled={busy} title="Показать код для отметки прихода"><QrCode size={13} aria-hidden="true" /> Код</button>
                      {currentStatus === "scheduled" ? <button type="button" className="inline-action" onClick={() => void patchAppointment(appointment, { status: "CONFIRMED" }, "Не удалось подтвердить запись", "Запись подтверждена")} disabled={busy} aria-busy={busy || undefined}><Check size={14} aria-hidden="true" /> Подтвердить</button> : null}
                      {["scheduled", "confirmed"].includes(currentStatus) ? <button type="button" className="inline-action" onClick={() => void patchAppointment(appointment, { status: "ARRIVED" }, "Не удалось отметить приход", "Клиент отмечен как пришедший")} disabled={busy} aria-busy={busy || undefined}><UserCheck size={14} aria-hidden="true" /> Пришёл</button> : null}
                      {currentStatus === "arrived" ? <button type="button" className="inline-action" onClick={() => void patchAppointment(appointment, { status: "IN_PROGRESS" }, "Не удалось начать приём", "Приём начат")} disabled={busy} aria-busy={busy || undefined}><Play size={14} aria-hidden="true" /> Начать</button> : null}
                      {currentStatus === "in_progress" ? <button type="button" className="inline-action" onClick={() => { setFollowUpDays("30"); setFormError(null); setFollowUpAppointment(appointment); }} disabled={busy}><Check size={14} aria-hidden="true" /> Завершить</button> : null}
                      <button type="button" className="inline-action danger-action" onClick={() => { setFormError(null); setCancelReason(""); setCancelTarget({ appointment, status: "CANCELLED" }); }} disabled={busy}><XCircle size={14} aria-hidden="true" /> Отменить</button>
                      {["scheduled", "confirmed"].includes(currentStatus) ? <button type="button" className="inline-action" onClick={() => { setFormError(null); setCancelReason(""); setCancelTarget({ appointment, status: "NO_SHOW" }); }} disabled={busy}>Неявка</button> : null}
                    </> : null}
                    {!["cancelled", "no_show"].includes(currentStatus) && balance > 0 ? <button type="button" className="inline-action" onClick={() => { setFormError(null); setPaymentAppointment(appointment); }} disabled={busy}>Оплата</button> : null}</div></td>
                  </tr>;
                })}</tbody>
              </ResponsiveTable>
            </div>
          )}
        </SectionCard>
      </> : null}

      {modalOpen ? <Modal title="Новая запись" busy={saving} onClose={() => setModalOpen(false)} footer={<><Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>Отмена</Button><Button type="submit" form="appointment-form" loading={saving}>Создать запись</Button></>}>
        <form id="appointment-form" className="form-grid" onSubmit={createAppointment}>
          <FormField label="Дата и время" hint="Время по часовому поясу центра"><input name="startsAt" type="datetime-local" required defaultValue={dateInputValue(new Date(Date.now() + 60 * 60 * 1000))} /></FormField>
          <FormField label="Статус"><select name="status" defaultValue="SCHEDULED"><option value="SCHEDULED">Запланирован</option><option value="CONFIRMED">Подтверждён</option></select></FormField>
          <div className="form-field-wide client-picker">
            <div className="client-picker-toggle" role="group" aria-label="Клиент">
              <button type="button" className={`segment-button ${!newClient ? "segment-button-active" : ""}`} onClick={() => setNewClient(false)} aria-pressed={!newClient}>Из базы</button>
              <button type="button" className={`segment-button ${newClient ? "segment-button-active" : ""}`} onClick={() => setNewClient(true)} aria-pressed={newClient}>Новый клиент</button>
            </div>
            {newClient ? <div className="form-grid">
              <FormField label="Имя и фамилия"><input name="clientName" required minLength={2} placeholder="Например, Анна Иванова" /></FormField>
              <FormField label="Телефон"><PhoneInput name="clientPhone" required placeholder="+7 700 123 45 67" /></FormField>
            </div> : <div className="form-grid">
              <FormField label="Поиск клиента" hint={catalogTruncated ? "Показаны первые 200 клиентов — уточните поиск или добавьте клиента как нового" : undefined}><input value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Имя или телефон" autoComplete="off" /></FormField>
              <FormField label="Клиент"><select name="clientId" required defaultValue=""><option value="">{visibleClients.length ? "Выберите клиента" : "Совпадений нет"}</option>{visibleClients.map((client) => <option key={client.id} value={client.id}>{client.fullName} · {client.phone}</option>)}</select></FormField>
            </div>}
          </div>
          <FormField label="Услуга"><select name="serviceId" required defaultValue=""><option value="">Выберите услугу</option>{services.filter((service) => service.isActive).map((service) => <option key={service.id} value={service.id}>{service.name} · {Number(service.price || 0).toLocaleString("ru-RU")} ₸</option>)}</select></FormField>
          <FormField label="Специалист"><select name="employeeId" required defaultValue={employees.length === 1 ? employees[0].id : ""}><option value="">Выберите специалиста</option>{employees.filter((employee) => employee.isActive).map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}{employee.branchName ? ` · ${employee.branchName}` : ""}</option>)}</select></FormField>
          <FormField label="Филиал"><select name="branchId" required defaultValue={branches.length === 1 ? branches[0].id : ""}><option value="">Выберите филиал</option>{branches.filter((branch) => branch.isActive).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></FormField>
          <FormField label="Комментарий" className="form-field-wide"><textarea name="notes" rows={3} maxLength={2000} placeholder="Что важно учесть перед приёмом" /></FormField>
          {formError ? <InlineError>{formError}</InlineError> : null}
        </form>
      </Modal> : null}
      {paymentAppointment ? <Modal title={`Оплата · ${paymentAppointment.clientName}`} busy={paymentSaving} onClose={() => setPaymentAppointment(null)} footer={<><Button variant="secondary" onClick={() => setPaymentAppointment(null)} disabled={paymentSaving}>Отмена</Button><Button form="payment-form" type="submit" loading={paymentSaving}>Провести оплату</Button></>}>
        <form id="payment-form" className="form-grid" onSubmit={createPayment}><FormField label="Сумма, ₸" hint={`Остаток к оплате: ${paymentBalance.toLocaleString("ru-RU")} ₸`}><input name="amount" type="number" min="0.01" max={paymentBalance || undefined} step="0.01" required defaultValue={paymentBalance} /></FormField><FormField label="Способ оплаты"><select name="method" defaultValue="CASH"><option value="CASH">Наличные</option><option value="CARD">Карта</option><option value="QR">QR / Kaspi</option><option value="TRANSFER">Перевод</option><option value="OTHER">Другое</option></select></FormField><FormField label="Комментарий" className="form-field-wide"><textarea name="note" rows={2} maxLength={500} placeholder="Например, частичная оплата" /></FormField>{formError ? <InlineError>{formError}</InlineError> : null}</form>
      </Modal> : null}
      {followUpAppointment ? <Modal title={`Завершение · ${followUpAppointment.clientName}`} busy={updatingId === followUpAppointment.id} onClose={() => setFollowUpAppointment(null)} footer={<><Button variant="secondary" onClick={() => setFollowUpAppointment(null)} disabled={updatingId === followUpAppointment.id}>Отмена</Button><Button loading={updatingId === followUpAppointment.id} onClick={() => void completeAppointment(followUpAppointment, followUpDays === "0" ? null : Number(followUpDays))}>Завершить приём</Button></>}><p className="modal-intro">Приём будет завершён, бонусы и расходники учтутся автоматически. Интервал повторного визита можно изменить позже в разделе «Удержание клиентов».</p><FormField label="Рекомендуемый повтор"><select value={followUpDays} onChange={(event) => setFollowUpDays(event.target.value)}><option value="0">Без напоминания</option><option value="7">Через 7 дней</option><option value="14">Через 14 дней</option><option value="21">Через 21 день</option><option value="30">Через 30 дней</option><option value="45">Через 45 дней</option><option value="60">Через 60 дней</option><option value="90">Через 90 дней</option></select></FormField>{formError ? <InlineError>{formError}</InlineError> : null}</Modal> : null}
      {cancelTarget ? <ConfirmDialog title={cancelTarget.status === "NO_SHOW" ? "Отметить неявку" : "Отменить запись"} description={`${formatDateTime(cancelTarget.appointment.startsAt)} · ${cancelTarget.appointment.clientName}${cancelTarget.appointment.serviceName ? ` · ${cancelTarget.appointment.serviceName}` : ""}`} confirmLabel={cancelTarget.status === "NO_SHOW" ? "Отметить неявку" : "Отменить запись"} cancelLabel="Оставить запись" danger pending={updatingId === cancelTarget.appointment.id} error={formError} onConfirm={() => void confirmCancellation()} onClose={() => { setCancelTarget(null); setCancelReason(""); }}>
        <FormField label="Причина" hint="Клиент получит уведомление в Telegram"><input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} maxLength={500} placeholder={cancelTarget.status === "NO_SHOW" ? "Клиент не пришёл" : "Например, перенос по просьбе клиента"} /></FormField>
      </ConfirmDialog> : null}
      {checkInOpen ? <Modal title="Отметить приход клиента" busy={checkInSaving} onClose={() => setCheckInOpen(false)} footer={<Button variant="secondary" onClick={() => setCheckInOpen(false)} disabled={checkInSaving}>Закрыть</Button>}>
        <form className="checkin-form" onSubmit={submitCheckIn}>
          <p className="modal-intro">Введите код из кабинета клиента или отсканируйте QR-код в Telegram. После проверки запись перейдёт в статус «Пришёл».</p>
          <FormField label="Код клиента"><input value={checkInCode} onChange={(event) => setCheckInCode(event.target.value.toUpperCase())} placeholder="Например, 8F20A1BC9D" autoFocus /></FormField>
          <div className="checkin-actions"><Button variant="secondary" onClick={scanQr}><ScanLine size={14} aria-hidden="true" /> Сканировать QR</Button><Button type="submit" loading={checkInSaving} disabled={!checkInCode}>Отметить пришедшим</Button></div>
          {checkInMessage ? <p className="client-notice" role="status">{checkInMessage}</p> : null}
        </form>
      </Modal> : null}
    </>
  );
}
