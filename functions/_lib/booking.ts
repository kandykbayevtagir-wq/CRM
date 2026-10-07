import { reservationStarts } from "../../src/lib/appointments/reservations";
import { newId } from "./http";

export function reservationStatements(db: D1Database, appointmentId: string, employeeId: string, startsAt: string, endsAt: string) {
  return reservationStarts(startsAt, endsAt).map((slotStart) => db.prepare(
    "INSERT INTO appointment_slot_reservations (id, appointment_id, employee_id, slot_start) VALUES (?, ?, ?, ?)",
  ).bind(newId(), appointmentId, employeeId, slotStart));
}

export function appointmentReminderStatements(db: D1Database, appointmentId: string, clientId: string, startsAt: string) {
  return [["REMINDER_24H", 24], ["REMINDER_2H", 2]].flatMap(([kind, hours]) => {
    const scheduledAt = new Date(Date.parse(startsAt) - Number(hours) * 3600000);
    return scheduledAt.getTime() > Date.now() ? [db.prepare(`INSERT INTO notifications(id,user_id,client_id,appointment_id,kind,scheduled_at,payload_json)
      VALUES(?, (SELECT id FROM users WHERE client_id = ? AND active = 1 LIMIT 1), ?, ?, ?, ?, ?)`)
      .bind(newId(),clientId,clientId,appointmentId,kind,scheduledAt.toISOString(),JSON.stringify({startsAt}))] : [];
  });
}
