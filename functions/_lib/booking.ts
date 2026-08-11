import { reservationStarts } from "../../src/lib/appointments/reservations";
import { newId } from "./http";

export function reservationStatements(db: D1Database, appointmentId: string, employeeId: string, startsAt: string, endsAt: string) {
  return reservationStarts(startsAt, endsAt).map((slotStart) => db.prepare(
    "INSERT INTO appointment_slot_reservations (id, appointment_id, employee_id, slot_start) VALUES (?, ?, ?, ?)",
  ).bind(newId(), appointmentId, employeeId, slotStart));
}
