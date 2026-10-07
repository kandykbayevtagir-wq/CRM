import { localDate, localDayRange } from "../../src/lib/appointments/schedule";

type ScheduleRow = { employeeId: string; dayOfWeek: number; startsTime: string; endsTime: string; breakStartTime: string | null; breakEndTime: string | null };
type TimeOffRow = { employeeId: string; startsAt: string; endsAt: string };
type WorkingPolicy = { startTime?: string; endTime?: string; workingDays?: string };

export function calculateAvailableWorkingMinutes(schedules: ScheduleRow[], timeOff: TimeOffRow[], from: Date, to: Date, timezone: string, policy: WorkingPolicy = {}) {
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) return 0;
  const firstDate = localDate(from, timezone);
  const lastDate = localDate(new Date(to.getTime() - 1), timezone);
  const days = Math.round((Date.parse(lastDate + "T12:00:00Z") - Date.parse(firstDate + "T12:00:00Z")) / 86400000) + 1;
  let total = 0;
  const timeMinutes = (value: string) => { const [hour,minute] = value.split(":").map(Number); return hour * 60 + minute; };
  for (let index = 0; index < days; index++) {
    const date = new Date(Date.parse(firstDate + "T12:00:00Z") + index * 86400000).toISOString().slice(0,10);
    const day = new Date(date + "T12:00:00Z").getUTCDay() || 7;
    if (policy.workingDays && !policy.workingDays.split(",").map(Number).includes(day)) continue;
    const dayStart = Date.parse(localDayRange(date,timezone).from);
    const at = (value: string) => dayStart + timeMinutes(value) * 60000;
    for (const shift of schedules.filter((value) => value.dayOfWeek === day)) {
      const start = Math.max(at(shift.startsTime), policy.startTime ? at(policy.startTime) : -Infinity, from.getTime());
      const end = Math.min(at(shift.endsTime), policy.endTime ? at(policy.endTime) : Infinity, to.getTime());
      if (end <= start) continue;
      const blocked = timeOff.filter((absence) => absence.employeeId === shift.employeeId).map((absence) => [Date.parse(absence.startsAt),Date.parse(absence.endsAt)]);
      if (shift.breakStartTime && shift.breakEndTime) blocked.push([at(shift.breakStartTime),at(shift.breakEndTime)]);
      const clipped = blocked.map(([left,right]) => [Math.max(start,left),Math.min(end,right)]).filter(([left,right]) => right > left).sort((a,b) => a[0] - b[0]);
      let unavailable = 0; let left = -Infinity; let right = -Infinity;
      for (const [nextLeft,nextRight] of clipped) {
        if (nextLeft > right) { if (right > left) unavailable += right - left; left = nextLeft; right = nextRight; }
        else right = Math.max(right,nextRight);
      }
      if (right > left) unavailable += right - left;
      total += (end - start - unavailable) / 60000;
    }
  }
  return Math.round(total);
}
