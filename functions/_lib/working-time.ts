type ScheduleRow = {
  employeeId: string;
  dayOfWeek: number;
  startsTime: string;
  endsTime: string;
  breakStartTime: string | null;
  breakEndTime: string | null;
};

type TimeOffRow = { employeeId: string; startsAt: string; endsAt: string };

function timeMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

function timezoneOffset(date: string, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(`${date}T12:00:00.000Z`));
    const value = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
    if (value === "GMT") return "+00:00";
    const match = value.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
    return match ? `${match[1]}${match[2].padStart(2, "0")}:${match[3] ?? "00"}` : "+00:00";
  } catch {
    return "+00:00";
  }
}

function atLocal(date: string, minutes: number, timezone: string): number {
  const hours = Math.floor(minutes / 60).toString().padStart(2, "0");
  const remainder = (minutes % 60).toString().padStart(2, "0");
  return new Date(`${date}T${hours}:${remainder}:00${timezoneOffset(date, timezone)}`).getTime();
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function calculateAvailableWorkingMinutes(
  schedules: ScheduleRow[],
  timeOff: TimeOffRow[],
  from: Date,
  to: Date,
  timezone: string,
): number {
  const scheduleByDay = new Map<number, ScheduleRow[]>();
  for (const row of schedules) {
    const rows = scheduleByDay.get(row.dayOfWeek) ?? [];
    rows.push(row);
    scheduleByDay.set(row.dayOfWeek, rows);
  }
  const totalDays = Math.max(0, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
  let total = 0;
  for (let index = 0; index < totalDays; index += 1) {
    const date = new Date(from.getTime() + index * 86_400_000);
    const key = dateKey(date);
    const day = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
    for (const schedule of scheduleByDay.get(day) ?? []) {
      const shiftStart = atLocal(key, timeMinutes(schedule.startsTime), timezone);
      const shiftEnd = atLocal(key, timeMinutes(schedule.endsTime), timezone);
      let available = Math.max(0, shiftEnd - shiftStart) / 60_000;
      if (schedule.breakStartTime && schedule.breakEndTime) available -= Math.max(0, atLocal(key, timeMinutes(schedule.breakEndTime), timezone) - atLocal(key, timeMinutes(schedule.breakStartTime), timezone)) / 60_000;
      for (const absence of timeOff) {
        const absenceStart = new Date(absence.startsAt).getTime();
        const absenceEnd = new Date(absence.endsAt).getTime();
        const overlap = Math.max(0, Math.min(shiftEnd, absenceEnd) - Math.max(shiftStart, absenceStart)) / 60_000;
        if (absence.employeeId === schedule.employeeId) available -= overlap;
      }
      total += Math.max(0, available);
    }
  }
  return Math.round(total);
}
