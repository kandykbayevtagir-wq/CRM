"use client";

import { useSearchParams } from "next/navigation";

import { AuthHint, ErrorState, isAuthError, LoadingState } from "@/components/data-state";
import { ClientAppointmentsView, ClientBookingView, ClientHomeView, ClientLoyaltyView } from "@/components/client-views";
import { DashboardView } from "@/components/dashboard-view";
import type { AuthResponse } from "@/lib/crm-types";
import { useApi } from "@/lib/use-api";

export function HomeRouter() {
  const searchParams = useSearchParams();
  const { data, loading, error, reload } = useApi<AuthResponse>("/api/auth/me");
  if (loading && !data) return <LoadingState label="Подключаем ваш кабинет…" />;
  if (error && isAuthError(error)) return <AuthHint />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (data?.user.role === "CLIENT") {
    const startParam = searchParams.get("startapp") ?? searchParams.get("start_param") ?? window.Telegram?.WebApp.initDataUnsafe?.start_param;
    if (startParam === "book" || startParam === "booking") return <ClientBookingView />;
    if (startParam === "appointments" || startParam === "visits") return <ClientAppointmentsView />;
    if (startParam === "loyalty" || startParam === "bonuses") return <ClientLoyaltyView />;
    return <ClientHomeView />;
  }
  return <DashboardView />;
}
