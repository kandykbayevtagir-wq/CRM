"use client";

import { FormEvent, useMemo, useState } from "react";
import { CalendarClock, Clock3, Plus, Trash2 } from "lucide-react";

import { apiFetch, dispatchCrmEvent } from "@/lib/api-client";
import { AuthHint, EmptyState, ErrorState, FormField, isAuthError, LoadingState, Modal } from "@/components/data-state";
import { Button, PageHeader, SectionCard } from "@/components/ui";
import { dateInputValue, formatDateTime } from "@/lib/format";
import { useApi } from "@/lib/use-api";

type Employee = { id: string; fullName: string; position: string };
type Schedule = { id: string; employeeId: string; dayOfWeek: number; startsTime: string; endsTime: string; isActive: number };
type TimeOff = { id: string; employeeId: string; employeeName: string; startsAt: string; endsAt: string; reason: string | null };
type ScheduleResponse = { ok: true; employees: Employee[]; schedules: Schedule[]; timeOff: TimeOff[] };
const days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function ScheduleModal({ employee, schedule, onClose, onSaved }: { employee?: Employee; schedule?: Schedule; onClose: () => void; onSaved: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const values: Record<string, unknown> = Object.fromEntries(new FormData(event.currentTarget).entries());
    values.isActive = values.isActive === "on";
    try {
      await apiFetch("/api/schedules", { method: "POST", body: values });
      dispatchCrmEvent("crm:data-changed");
      await onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить расписание");
    } finally {
      setSaving(false);
    }
  }
  return <Modal title="Рабочий интервал" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Отмена</Button><button className="button button-primary" form="schedule-form" type="submit" disabled={saving}>{saving ? "Сохраняем…" : "Сохранить"}</button></>}>
    <form id="schedule-form" className="form-grid" onSubmit={submit}>
      <FormField label="Сотрудник" className="form-field-wide"><select name="employeeId" required defaultValue={employee?.id ?? schedule?.employeeId ?? ""}><option value="">Выберите сотрудника</option>{employee ? <option value={employee.id}>{employee.fullName}</option> : null}</select></FormField>
      <FormField label="День недели"><select name="dayOfWeek" required defaultValue={String(schedule?.dayOfWeek ?? 1)}>{days.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></FormField>
      <FormField label="Начало"><input name="startsTime" type="time" required defaultValue={schedule?.startsTime ?? "09:00"} /></FormField>
      <FormField label="Конец"><input name="endsTime" type="time" required defaultValue={schedule?.endsTime ?? "18:00"} /></FormField>
      <label className="consent-row form-field-wide"><input name="isActive" type="checkbox" defaultChecked={schedule?.isActive !== 0} /><span><strong>Рабочий день активен</strong><small>Неактивный интервал временно исключается из онлайн-записи.</small></span></label>
      {error ? <p className="form-error form-field-wide">{error}</p> : null}
    </form>
  </Modal>;
}

function TimeOffModal({ employees, onClose, onSaved }: { employees: Employee[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await apiFetch("/api/time-off", { method: "POST", body: values });
      dispatchCrmEvent("crm:data-changed");
      await onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось добавить отсутствие");
    } finally {
      setSaving(false);
    }
  }
  return <Modal title="Добавить отсутствие" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Отмена</Button><button className="button button-primary" form="time-off-form" type="submit" disabled={saving}>{saving ? "Сохраняем…" : "Добавить"}</button></>}>
    <form id="time-off-form" className="form-grid" onSubmit={submit}>
      <FormField label="Сотрудник" className="form-field-wide"><select name="employeeId" required defaultValue=""><option value="">Выберите сотрудника</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}</option>)}</select></FormField>
      <FormField label="Начало"><input name="startsAt" type="datetime-local" required defaultValue={dateInputValue(new Date(Date.now() + 24 * 60 * 60_000))} /></FormField>
      <FormField label="Конец"><input name="endsAt" type="datetime-local" required defaultValue={dateInputValue(new Date(Date.now() + 2 * 24 * 60 * 60_000))} /></FormField>
      <FormField label="Причина" className="form-field-wide"><input name="reason" placeholder="Отпуск, обучение, больничный" /></FormField>
      {error ? <p className="form-error form-field-wide">{error}</p> : null}
    </form>
  </Modal>;
}

export function ScheduleView() {
  const { data, loading, error, reload } = useApi<ScheduleResponse>("/api/schedules");
  const [scheduleModal, setScheduleModal] = useState<{ employee?: Employee; schedule?: Schedule } | null>(null);
  const [timeOffModal, setTimeOffModal] = useState(false);
  const scheduleMap = useMemo(() => new Map((data?.schedules ?? []).map((item) => [`${item.employeeId}:${item.dayOfWeek}`, item])), [data?.schedules]);

  async function removeTimeOff(id: string) {
    if (!window.confirm("Удалить этот период отсутствия?")) return;
    await apiFetch(`/api/time-off?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    dispatchCrmEvent("crm:data-changed");
    await reload();
  }

  if (loading && !data) return <LoadingState />;
  if (error && isAuthError(error)) return <AuthHint />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  return <>
    <PageHeader eyebrow="Управление" title="Расписание" description="Настройте рабочие часы специалистов и заранее исключайте отпуска из онлайн-записи." actions={<><Button variant="secondary" onClick={() => setTimeOffModal(true)}><CalendarClock size={15} /> Добавить отсутствие</Button><Button onClick={() => setScheduleModal({})}><Plus size={15} /> Рабочий интервал</Button></>} />
    <SectionCard title="Рабочие часы специалистов" subtitle="Если для дня нет отдельного интервала, используются общие правила из настроек.">
      {data.employees.length === 0 ? <EmptyState title="Сначала добавьте сотрудников" description="После добавления специалиста здесь появится его недельное расписание." /> : <div className="schedule-employee-list">{data.employees.map((employee) => <article className="schedule-employee-card" key={employee.id}><div className="schedule-employee-heading"><div><strong>{employee.fullName}</strong><span>{employee.position}</span></div><Button variant="secondary" onClick={() => setScheduleModal({ employee })}><Plus size={13} /> Настроить</Button></div><div className="schedule-week">{days.map((day, index) => { const schedule = scheduleMap.get(`${employee.id}:${index + 1}`); return <button className={`schedule-day ${schedule?.isActive ? "schedule-day-active" : ""}`} key={day} onClick={() => setScheduleModal({ employee, schedule })}><b>{day}</b><span>{schedule?.isActive ? `${schedule.startsTime}–${schedule.endsTime}` : "Выходной"}</span></button>; })}</div></article>)}</div>}
    </SectionCard>
    <SectionCard title="Ближайшие отсутствия" subtitle="Эти периоды блокируют свободные окна специалиста">
      {data.timeOff.length === 0 ? <EmptyState title="Запланированных отсутствий нет" description="Добавьте отпуск или другой период, когда специалист недоступен." action={<Button variant="secondary" onClick={() => setTimeOffModal(true)}><Plus size={14} /> Добавить</Button>} /> : <div className="time-off-list">{data.timeOff.map((item) => <div className="time-off-row" key={item.id}><span className="time-off-icon"><Clock3 size={15} /></span><div><strong>{item.employeeName}</strong><small>{formatDateTime(item.startsAt)} — {formatDateTime(item.endsAt)}{item.reason ? ` · ${item.reason}` : ""}</small></div><button className="inline-action danger-action" onClick={() => void removeTimeOff(item.id)} aria-label="Удалить отсутствие"><Trash2 size={14} /></button></div>)}</div>}
    </SectionCard>
    {scheduleModal ? <ScheduleModal employee={scheduleModal.employee} schedule={scheduleModal.schedule} onClose={() => setScheduleModal(null)} onSaved={reload} /> : null}
    {timeOffModal ? <TimeOffModal employees={data.employees} onClose={() => setTimeOffModal(false)} onSaved={reload} /> : null}
  </>;
}
