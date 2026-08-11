import type { CrmRole } from "../permissions";

export function resolveTelegramRole(existingRole: string | null | undefined, telegramId: string, ownerTelegramId: string) {
  if (existingRole) return existingRole as CrmRole;
  return ownerTelegramId && telegramId === ownerTelegramId ? "OWNER" : "CLIENT";
}

export function isStaffTelegramAllowed(role: string, telegramId: string, allowedStaffIds: readonly string[], ownerTelegramId: string) {
  if (role === "CLIENT") return true;
  return telegramId === ownerTelegramId || allowedStaffIds.includes(telegramId);
}
