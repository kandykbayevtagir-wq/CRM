export function validShift(start: string, end: string, breakStart: string | null, breakEnd: string | null) {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  return time.test(start) && time.test(end) && start < end &&
    ((!breakStart && !breakEnd) || Boolean(breakStart && breakEnd && time.test(breakStart) && time.test(breakEnd) && start <= breakStart && breakStart < breakEnd && breakEnd <= end));
}

export function localDate(value: string | Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export function localDayRange(date: string, timezone: string) {
  const atMidnight = (key: string) => {
    const target = Date.parse(key + "T00:00:00Z");
    let instant = target;
    for (let attempt = 0; attempt < 3; attempt++) {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
      const part = (type: string) => parts.find((value) => value.type === type)?.value;
      const represented = Date.parse(`${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}Z`);
      instant += target - represented;
    }
    return new Date(instant).toISOString();
  };
  const nextDate = new Date(Date.parse(date + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
  return { from: atMidnight(date), to: atMidnight(nextDate) };
}
