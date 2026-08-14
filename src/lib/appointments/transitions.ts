export type AppointmentStatus = "SCHEDULED" | "CONFIRMED" | "ARRIVED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

const transitions: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  SCHEDULED: ["CONFIRMED", "ARRIVED", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["ARRIVED", "CANCELLED", "NO_SHOW"],
  ARRIVED: ["IN_PROGRESS", "CANCELLED", "NO_SHOW"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function isAppointmentStatus(value: string): value is AppointmentStatus {
  return value in transitions;
}

export function canTransitionAppointment(from: string, to: string, administrativeOverride = false): boolean {
  if (from === to) return true;
  if (!isAppointmentStatus(from) || !isAppointmentStatus(to)) return false;
  if (administrativeOverride && from === "COMPLETED" && to === "CANCELLED") return true;
  return transitions[from].includes(to);
}

export function appointmentStatusTransitions(from: AppointmentStatus): readonly AppointmentStatus[] {
  return transitions[from];
}
