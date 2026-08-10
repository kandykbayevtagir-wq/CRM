import { Suspense } from "react";

import { AppShell } from "@/components/app-shell";
import { ClientReviewsView } from "@/components/client-views";

export default function ClientReviewsPage() {
  return <Suspense fallback={null}><AppShell><ClientReviewsView /></AppShell></Suspense>;
}
