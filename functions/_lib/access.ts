import type { AuthUser } from "./auth";

/** Returns the active employee record represented by a CRM specialist user. */
export async function getOwnEmployeeId(db: D1Database, user: AuthUser): Promise<string | null> {
  if (user.role !== "SPECIALIST") return null;
  const employee = await db.prepare("SELECT id FROM employees WHERE user_id = ? AND is_active = 1 LIMIT 1")
    .bind(user.id)
    .first<{ id: string }>();
  return employee?.id ?? null;
}

/** A specialist must never receive an unscoped staff dataset. */
export function specialistHasEmployee(user: AuthUser, employeeId: string | null): boolean {
  return user.role !== "SPECIALIST" || Boolean(employeeId);
}

/** The client's card id when the card exists and is not archived; null otherwise. */
export async function getActiveClientId(db: D1Database, user: AuthUser): Promise<string | null> {
  if (!user.clientId) return null;
  const row = await db.prepare("SELECT id FROM clients WHERE id = ? AND is_active = 1").bind(user.clientId).first<{ id: string }>();
  return row?.id ?? null;
}
