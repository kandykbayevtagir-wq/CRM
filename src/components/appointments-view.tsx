"use client";

import { FormEvent, useDeferredValue, useState } from "react";
import { CalendarDays, Check, Download, Plus, QrCode, ScanLine, Search } from "lucide-react";

import { apiFetch, dispatchCrmEvent } from "@/lib/api-client";
import { AuthHint, EmptyState, ErrorState, FormField, isAuthError, LoadingState, Modal } from "@/components/data-state";
import { Amount, Avatar, Button, PageHeader, SectionCard, StatusPill } from "@/components/ui";
import type { AppointmentRecord, Branch, EmployeeRecord } from "@/lib/crm-types";
import { dateInputValue, formatDateTime, initials } from "@/lib/format";
import { useApi } from "@/lib/use-api";

type AppointmentResponse = { ok: true; items: AppointmentRecord[] };
type BranchResponse = { ok: true; items: Branch[] };
type EmployeeResponse = { ok: true; items: EmployeeRecord[] };

function statusKey(status: string) {
  return status.toLowerCase();
}

export function AppointmentsView() {
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [checkInCode, setCheckInCode] = useState("");
  const [checkInMessage, setCheckInMessage] = useState<string | null>(null);
  const [checkInSaving, setCheckInSaving] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const path = `/api/appointments${deferredQuery.trim() ? `?q=${encodeURIComponent(deferredQuery.trim())}` : ""}`;
  const { data, loading, error, reload } = useApi<AppointmentResponse>(path);
  const { data: branches } = useApi<BranchResponse>("/api/branches");
  const { data: employees } = useApi<EmployeeResponse>("/api/employees");
  const items = data?.items ?? [];
  const completed = items.filter((item) => statusKey(item.status) === "completed").length;
  const expected = items.filter((item) => !["cancelled", "no_show"].includes(statusKey(item.status))).reduce((sum, item) => sum + Number(item.amount || 0), 0);

  async function createAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await apiFetch("/api/appointments", { method: "POST", body: values });
      setModalOpen(false);
      dispatchCrmEvent("crm:data-changed");
      await reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Не удалось создать запись");
    } finally {
      setSaving(false);
    }
  }

  async function completeAppointment(id: string) {
    setUpdatingId(id);
    try {
      await apiFetch(`/api/appointments/${id}`, { method: "PATCH", body: { status: "COMPLETED" } });
      dispatchCrmEvent("crm:data-changed");
      await reload();
    } finally {
      setUpdatingId(null);
    }
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
      setCheckInMessage(cause instanceof Error ? cause.message : "Не удалось выполнить check-in");
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

  return (
    <>
      <PageHeader
        eyebrow="Рабочий стол"
        title="Записи"
        description="Календарь приёмов, статусы клиентов и загрузка специалистов — всё хранится в облаке."
        actions={<><Button variant="secondary" onClick={() => { setCheckInCode(""); setCheckInMessage(null); setCheckInOpen(true); }}><ScanLine size={15} /> Check-in</Button><Button variant="secondary" onClick={() => window.print()}><Download size={15} /> Печать</Button><Button onClick={() => { setFormError(null); setModalOpen(true); }}><Plus size={16} /> Новая запись</Button></>}
      />

      {loading && !data ? <LoadingState /> : null}
      {error && isAuthError(error) ? <AuthHint /> : null}
      {error && !isAuthError(error) ? <ErrorState message={error} onRetry={reload} /> : null}

      {data ? <>
        <div className="stat-strip">
          <div className="small-stat"><span>Записей загружено</span><strong>{items.length}</strong></div>
          <div className="small-stat"><span>Завершено</span><strong>{completed}</strong></div>
          <div className="small-stat"><span>Сумма без отмен</span><strong className="small-stat-label">{expected.toLocaleString("ru-RU")} ₸</strong></div>
        </div>

        <div className="filter-bar">
          <label className="filter-select search-input"><span>Поиск записи</span><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя или телефон" /></label>
          <div className="filter-spacer" />
          <span className="table-secondary">{deferredQuery ? `Результаты для «${deferredQuery}»` : "Последние записи"}</span>
        </div>

        <SectionCard title="Расписание" subtitle="Создавайте и завершайте приёмы без ручной синхронизации" action={<span className="icon-button"><CalendarDays size={18} /></span>}>
          {items.length === 0 ? <EmptyState title="Записей пока нет" description="Добавьте первый приём — клиент автоматически появится в базе." action={<Button onClick={() => setModalOpen(true)}><Plus size={15} /> Добавить запись</Button>} /> : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Дата и время</th><th>Клиент</th><th>Специалист</th><th>Филиал</th><th>Статус</th><th>Сумма</th><th /></tr></thead>
                <tbody>{items.map((appointment, index) => {
                  const currentStatus = statusKey(appointment.status);
                  return <tr key={appointment.id}>
                    <td><span className="table-time">{formatDateTime(appointment.startsAt)}</span></td>
                    <td><div className="client-cell"><Avatar initials={initials(appointment.clientName)} tone={index % 3 === 0 ? "violet" : index % 3 === 1 ? "blue" : "peach"} /><div><strong>{appointment.clientName}</strong><span>{appointment.clientPhone}</span></div></div></td>
                    <td>{appointment.employeeName ?? "Не назначен"}<span className="table-secondary">{appointment.serviceName ?? "Услуга не указана"}</span></td>
                    <td>{appointment.branchName ?? "Без филиала"}</td>
                    <td><StatusPill status={currentStatus} /></td>
                    <td><Amount value={Number(appointment.amount || 0)} /></td>
                    <td><div className="appointment-actions">{!["completed", "cancelled", "no_show"].includes(currentStatus) ? <><button className="inline-action" onClick={() => void showAppointmentCode(appointment.id)} title="Показать код check-in"><QrCode size={13} /> Код</button><button className="inline-action" onClick={() => void completeAppointment(appointment.id)} disabled={updatingId === appointment.id} title="Завершить приём"><Check size={14} /> {updatingId === appointment.id ? "…" : "Завершить"}</button></> : null}</div></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </> : null}

      {modalOpen ? <Modal title="Новая запись" onClose={() => setModalOpen(false)} footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>Отмена</Button><button className="button button-primary" type="submit" form="appointment-form" disabled={saving}>{saving ? "Сохраняем…" : "Создать запись"}</button></>}>
        <form id="appointment-form" className="form-grid" onSubmit={createAppointment}>
          <FormField label="Дата и время"><input name="startsAt" type="datetime-local" required defaultValue={dateInputValue(new Date(Date.now() + 60 * 60 * 1000))} /></FormField>
          <FormField label="Статус"><select name="status" defaultValue="SCHEDULED"><option value="SCHEDULED">Запланирован</option><option value="CONFIRMED">Подтверждён</option><option value="ARRIVED">Пришёл</option><option value="IN_PROGRESS">В работе</option></select></FormField>
          <FormField label="Имя клиента"><input name="clientName" required placeholder="Имя и фамилия" /></FormField>
          <FormField label="Телефон клиента"><input name="clientPhone" required placeholder="+7 700 000 00 00" /></FormField>
          <FormField label="Услуга"><input name="serviceName" placeholder="Например, медицинский педикюр" /></FormField>
          <FormField label="Сумма, ₸"><input name="totalAmount" type="number" min="0" step="1" placeholder="0" /></FormField>
          <FormField label="Специалист"><select name="employeeId" defaultValue=""><option value="">Не назначен</option>{employees?.items.filter((employee) => employee.isActive).map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}</option>)}</select></FormField>
          <FormField label="Филиал"><select name="branchId" defaultValue=""><option value="">Без филиала</option>{branches?.items.filter((branch) => branch.isActive).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></FormField>
          <FormField label="Комментарий" className="form-field-wide"><textarea name="notes" rows={3} placeholder="Что важно учесть перед приёмом" /></FormField>
          {formError ? <p className="form-error form-field-wide">{formError}</p> : null}
        </form>
      </Modal> : null}
      {checkInOpen ? <Modal title="Check-in клиента" onClose={() => setCheckInOpen(false)} footer={<Button variant="secondary" onClick={() => setCheckInOpen(false)}>Закрыть</Button>}>
        <form className="checkin-form" onSubmit={submitCheckIn}>
          <p className="modal-intro">Введите код из кабинета клиента или отсканируйте QR-код в Telegram. После проверки запись перейдёт в статус «Пришёл».</p>
          <FormField label="Код check-in"><input value={checkInCode} onChange={(event) => setCheckInCode(event.target.value.toUpperCase())} placeholder="Например, 8F20A1BC9D" autoFocus /></FormField>
          <div className="checkin-actions"><Button variant="secondary" onClick={scanQr}><ScanLine size={14} /> Сканировать QR</Button><button className="button button-primary" type="submit" disabled={checkInSaving || !checkInCode}>{checkInSaving ? "Проверяем…" : "Отметить пришедшим"}</button></div>
          {checkInMessage ? <p className="client-notice">{checkInMessage}</p> : null}
        </form>
      </Modal> : null}
    </>
  );
}
