type CalendarVisit = { id: string; startsAt: string; endsAt: string; serviceName: string; branchName: string; address: string; sequence?: number };

function escape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/[,;]/g, (character) => "\\" + character);
}
function fold(line: string) {
  let segment = "";
  const lines: string[] = [];
  for (const character of line) {
    if (new TextEncoder().encode(segment + character).length > 73) { lines.push(segment); segment = " "; }
    segment += character;
  }
  lines.push(segment);
  return lines.join("\r\n");
}
export function visitCalendar(visit: CalendarVisit, stamp = new Date()) {
  const date = (value: string | Date) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//podologymk//Visits//RU", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    "UID:" + escape(visit.id) + "@podologymk", "SEQUENCE:" + String(Math.max(0, Math.floor(Number(visit.sequence ?? 0)))), "DTSTAMP:" + date(stamp), "DTSTART:" + date(visit.startsAt), "DTEND:" + date(visit.endsAt),
    "SUMMARY:" + escape(visit.serviceName), "LOCATION:" + escape([visit.branchName, visit.address].filter(Boolean).join(", ")),
    "DESCRIPTION:" + escape("Приём в podologymk. Перенос и отмена доступны в Telegram Mini App."),
    "END:VEVENT", "END:VCALENDAR", "",
  ].map(fold).join("\r\n");
}
