import { Suspense } from "react";

import { AppShell } from "@/components/app-shell";
import { ClientBookingView } from "@/components/client-views";

export default function ClientBookPage() {
  return <Suspense fallback={null}><AppShell><ClientBookingView /></AppShell></Suspense>;
}
