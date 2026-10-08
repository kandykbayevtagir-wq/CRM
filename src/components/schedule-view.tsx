"use client";

import { FormEvent, useMemo, useState } from "react";
import { CalendarClock, Clock3, Plus, Trash2 } from "lucide-react";

import { apiFetch, dispatchCrmEvent } from "@/lib/api-client";
import { AuthHint, ConfirmDialog, EmptyState, ErrorState, FormField, InlineError, isAuthError, LoadingState, Modal } from "@/components/data-state";
import { Button, PageHeader, SectionCard } from "@/components/ui";
import { dateInputValue, formatDateTime } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useCan } from "@/lib/current-user";

type Employee = { id: string; fullName: string; position: string };
type Schedule = { id: string; employeeId: string; dayOfWeek: number; startsTime: string; endsTime: string; breakStartTime?: string | null; breakEndTime?: string | null; isActive: number };
type TimeOff = { id: string; employeeId: string; employeeName: string; startsAt: string; endsAt: string; reason: string | null };
type ScheduleResponse = { ok: true; employees: Employee[]; schedules: Schedule[]; timeOff: TimeOff[] };
const days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const dayNames = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
const DAY = 24 * 60 * 60_000;

function ScheduleModal({ employees, employee, schedule, onClose, onSaved }: { employees: Employee[]; employee?: Employee; schedule?: Schedule; onClose: () => void; onSaved: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasBreak, setHasBreak] = useState(Boolean(schedule?.breakStartTime && schedule?.breakEndTime));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    const values: Record<string, unknown> = Object.fromEntries(new FormData(event.currentTarget).entries());
    values.isActive = values.isActive === "on";
    if (!hasBreak) { delete values.breakStartTime; delete values.breakEndTime; }
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
  const selectedEmployee = employee?.id ?? schedule?.employeeId ?? (employees.length === 1 ? employees[0].id : "");
  return <Modal title="Рабочий интервал" onClose={onClose} busy={saving} footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Отмена</Button><Button form="schedule-form" type="submit" loading={saving}>{saving ? "Сохраняем…" : "Сохранить"}</Button></>}>
    <form id="schedule-form" className="form-grid" onSubmit={submit}>
      <FormField label="Сотрудник" className="form-field-wide"><select name="employeeId" required defaultValue={selectedEmployee} disabled={Boolean(employee)}><option value="">Выберите сотрудника</option>{employees.map((item) => <option key={item.id} value={item.id}>{item.fullName} · {item.position}</option>)}</select></FormField>
      {employee ? <input type="hidden" name="employeeId" value={employee.id} /> : null}
      <FormField label="День недели"><select name="dayOfWeek" required defaultValue={String(schedule?.dayOfWeek ?? 1)}>{days.map((day, index) => <option key={day} value={index + 1}>{dayNames[index]}</option>)}</select></FormField>
      <FormField label="Начало"><input name="startsTime" type="time" required step={900} defaultValue={schedule?.startsTime ?? "09:00"} /></FormField>
      <FormField label="Конец"><input name="endsTime" type="time" required step={900} defaultValue={schedule?.endsTime ?? "18:00"} /></FormField>
      <label className="consent-row form-field-wide"><input type="checkbox" checked={hasBreak} onChange={(event) => setHasBreak(event.target.checked)} /><span><strong>Перерыв в течение дня</strong><small>Окна на время перерыва не предлагаются клиентам.</small></span></label>
      {hasBreak ? <>
        <FormField label="Начало перерыва"><input name="breakStartTime" type="time" required step={900} defaultValue={schedule?.breakStartTime ?? "13:00"} /></FormField>
        <FormField label="Конец перерыва"><input name="breakEndTime" type="time" required step={900} defaultValue={schedule?.breakEndTime ?? "14:00"} /></FormField>
      </> : null}
      <label className="consent-row form-field-wide"><input name="isActive" type="checkbox" defaultChecked={schedule?.isActive !== 0} /><span><strong>Рабочий день активен</strong><small>Неактивный интервал временно исключается из онлайн-записи.</small></span></label>
      {error ? <div className="form-field-wide"><InlineError>{error}</InlineError></div> : null}
    </form>
  </Modal>;
}

function TimeOffModal({ employees, onClose, onSaved }: { employees: Employee[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState(() => dateInputValue(new Date(Date.now() + DAY)).slice(0, 10) + "T09:00");
  const [endsAt, setEndsAt] = useState(() => dateInputValue(new Date(Date.now() + DAY)).slice(0, 10) + "T18:00");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (endsAt <= startsAt) { setError("Окончание должно быть позже начала"); return; }
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
  return <Modal title="Добавить отсутствие" onClose={onClose} busy={saving} footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Отмена</Button><Button form="time-off-form" type="submit" loading={saving}>{saving ? "Сохраняем…" : "Добавить"}</Button></>}>
    <form id="time-off-form" className="form-grid" onSubmit={submit}>
      <FormField label="Сотрудник" className="form-field-wide"><select name="employeeId" required defaultValue={employees.length === 1 ? employees[0].id : ""}><option value="">Выберите сотрудника</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}</option>)}</select></FormField>
      <FormField label="Начало" hint="Время центра (Алматы)"><input name="startsAt" type="datetime-local" required value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></FormField>
      <FormField label="Конец"><input name="endsAt" type="datetime-local" required min={startsAt} value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></FormField>
      <FormField label="Причина" className="form-field-wide"><input name="reason" maxLength={500} placeholder="Отпуск, обучение, больничный" /></FormField>
      {error ? <div className="form-field-wide"><InlineError>{error}</InlineError></div> : null}
    </form>
  </Modal>;
}

export function ScheduleView() {
  const { data, loading, error, reload } = useApi<ScheduleResponse>("/api/schedules");
  const canWrite = useCan("schedules.write");
  const [scheduleModal, setScheduleModal] = useState<{ employee?: Employee; schedule?: Schedule } | null>(null);
  const [timeOffModal, setTimeOffModal] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TimeOff | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const scheduleMap = useMemo(() => new Map((data?.schedules ?? []).map((item) => [`${item.employeeId}:${item.dayOfWeek}`, item])), [data?.schedules]);

  async function removeTimeOff() {
    if (!removeTarget || removing) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await apiFetch(`/api/time-off?id=${encodeURIComponent(removeTarget.id)}`, { method: "DELETE" });
      dispatchCrmEvent("crm:data-changed");
      setRemoveTarget(null);
      await reload();
    } catch (cause) {
      setRemoveError(cause instanceof Error ? cause.message : "Не удалось удалить отсутствие");
    } finally {
      setRemoving(false);
    }
  }

  if (loading && !data) return <LoadingState />;
  if (error && isAuthError(error)) return <AuthHint />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  return <>
    <PageHeader eyebrow="Управление" title="Расписание" description={canWrite ? "Настройте рабочие часы специалистов и заранее исключайте отпуска из онлайн-записи." : "Рабочие часы и отсутствия. Изменения вносит владелец центра."} actions={canWrite ? <><Button variant="secondary" onClick={() => setTimeOffModal(true)} disabled={data.employees.length === 0}><CalendarClock size={15} /> Добавить отсутствие</Button><Button onClick={() => setScheduleModal({})} disabled={data.employees.length === 0}><Plus size={15} /> Рабочий интервал</Button></> : undefined} />
    <SectionCard title="Рабочие часы специалистов" subtitle="Если для дня нет отдельного интервала, используются общие правила из настроек.">
      {data.employees.length === 0 ? <EmptyState title="Сначала добавьте сотрудников" description="После добавления специалиста здесь появится его недельное расписание." /> : <div className="schedule-employee-list">{data.employees.map((employee) => (
        <article className="schedule-employee-card" key={employee.id}>
          <div className="schedule-employee-heading"><div><strong>{employee.fullName}</strong><span>{employee.position}</span></div>{canWrite ? <Button variant="secondary" onClick={() => setScheduleModal({ employee })}><Plus size={13} /> Настроить</Button> : null}</div>
          <div className="schedule-week" role="list" aria-label={`Неделя: ${employee.fullName}`}>{days.map((day, index) => {
            const schedule = scheduleMap.get(`${employee.id}:${index + 1}`);
            const label = schedule?.isActive ? `${schedule.startsTime}–${schedule.endsTime}` : "Выходной";
            const content = <><b>{day}</b><span>{label}</span>{schedule?.isActive && schedule.breakStartTime && schedule.breakEndTime ? <small>перерыв {schedule.breakStartTime}–{schedule.breakEndTime}</small> : null}</>;
            return canWrite
              ? <button type="button" role="listitem" className={`schedule-day ${schedule?.isActive ? "schedule-day-active" : ""}`} key={day} onClick={() => setScheduleModal({ employee, schedule })} aria-label={`${dayNames[index]}: ${label}. Изменить`}>{content}</button>
              : <div role="listitem" className={`schedule-day ${schedule?.isActive ? "schedule-day-active" : ""}`} key={day}>{content}</div>;
          })}</div>
        </article>
      ))}</div>}
    </SectionCard>
    <SectionCard title="Ближайшие отсутствия" subtitle="Эти периоды блокируют свободные окна специалиста">
      {data.timeOff.length === 0 ? <EmptyState title="Запланированных отсутствий нет" description="Добавьте отпуск или другой период, когда специалист недоступен." action={canWrite && data.employees.length ? <Button variant="secondary" onClick={() => setTimeOffModal(true)}><Plus size={14} /> Добавить</Button> : undefined} /> : <div className="time-off-list">{data.timeOff.map((item) => <div className="time-off-row" key={item.id}><span className="time-off-icon"><Clock3 size={15} /></span><div><strong>{item.employeeName}</strong><small>{formatDateTime(item.startsAt)} — {formatDateTime(item.endsAt)}{item.reason ? ` · ${item.reason}` : ""}</small></div>{canWrite ? <button type="button" className="inline-action danger-action" onClick={() => { setRemoveError(null); setRemoveTarget(item); }} aria-label={`Удалить отсутствие: ${item.employeeName}`}><Trash2 size={14} /></button> : null}</div>)}</div>}
    </SectionCard>
    {scheduleModal ? <ScheduleModal employees={data.employees} employee={scheduleModal.employee} schedule={scheduleModal.schedule} onClose={() => setScheduleModal(null)} onSaved={reload} /> : null}
    {timeOffModal ? <TimeOffModal employees={data.employees} onClose={() => setTimeOffModal(false)} onSaved={reload} /> : null}
    {removeTarget ? <ConfirmDialog title="Удалить период отсутствия?" description={`${removeTarget.employeeName}: ${formatDateTime(removeTarget.startsAt)} — ${formatDateTime(removeTarget.endsAt)}. Окна специалиста на это время снова станут доступны для записи.`} confirmLabel="Удалить" danger pending={removing} error={removeError} onConfirm={() => void removeTimeOff()} onClose={() => { if (!removing) setRemoveTarget(null); }} /> : null}
  </>;
}
