import { AppShell } from "@/components/app-shell";
import { ClientDetailView } from "@/components/client-detail-view";

export function generateStaticParams() {
  return [{ id: "placeholder" }];
}

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppShell><ClientDetailView clientId={id} /></AppShell>;
}
