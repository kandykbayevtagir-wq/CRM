"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { AuthUser } from "@/lib/crm-types";
import { hasPermission, type Permission } from "@/lib/permissions";

const CurrentUserContext = createContext<AuthUser | null>(null);

export function CurrentUserProvider({ user, children }: { user: AuthUser | null; children: ReactNode }) {
  return <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>;
}

/** The authenticated staff user, or null while unknown (outside AppShell or before /api/auth/me resolves). */
export function useCurrentUser() {
  return useContext(CurrentUserContext);
}

/**
 * Role check for hiding actions the API would reject anyway.
 * Returns true while the user is unknown so a page never flashes "read-only" before auth resolves.
 */
export function useCan(permission: Permission) {
  const user = useContext(CurrentUserContext);
  return user ? hasPermission(user.role, permission) : true;
}
