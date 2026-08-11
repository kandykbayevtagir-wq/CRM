export const RESERVATION_QUANTUM_MINUTES = 15;

export type BookingRequest = {
  appointmentId?: string | null;
  startsAt: string;
  serviceId: string;
  branchId: string;
  employeeId: string;
};

export function reservationStarts(startsAt: string, endsAt: string, quantumMinutes = RESERVATION_QUANTUM_MINUTES) {
  const startMs = new Date(startsAt).getTime();
  const endMs = new Date(endsAt).getTime();
  const quantumMs = Math.max(1, quantumMinutes) * 60_000;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
  const first = Math.floor(startMs / quantumMs) * quantumMs;
  const starts: string[] = [];
  for (let cursor = first; cursor < endMs; cursor += quantumMs) starts.push(new Date(cursor).toISOString());
  return starts;
}

export function bookingRequestHash(request: BookingRequest) {
  return [request.appointmentId ?? "", request.startsAt, request.serviceId, request.branchId, request.employeeId].join("|");
}
