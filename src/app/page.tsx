import { Suspense } from "react";

import { AppShell } from "@/components/app-shell";
import { HomeRouter } from "@/components/home-router";

export default function DashboardPage() {
  return <Suspense fallback={null}><AppShell><HomeRouter /></AppShell></Suspense>;
}
