"use client";

import { MessageSquareText, Star } from "lucide-react";

import { apiFetch, dispatchCrmEvent } from "@/lib/api-client";
import { AuthHint, EmptyState, ErrorState, isAuthError, LoadingState } from "@/components/data-state";
import { PageHeader, SectionCard, StatusPill } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useApi } from "@/lib/use-api";

type AdminReview = { id: string; appointmentId: string; rating: number; reviewText: string | null; status: string; createdAt: string; clientName: string; serviceName: string | null };
type ReviewsResponse = { ok: true; items: AdminReview[] };

export function ReviewsView() {
  const { data, loading, error, reload } = useApi<ReviewsResponse>("/api/reviews");

  async function moderate(id: string, status: "PUBLISHED" | "HIDDEN" | "PENDING") {
    try {
      await apiFetch("/api/reviews", { method: "PATCH", body: { id, status } });
      dispatchCrmEvent("crm:data-changed");
      await reload();
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : "Не удалось изменить статус отзыва");
    }
  }

  if (loading && !data) return <LoadingState />;
  if (error && isAuthError(error)) return <AuthHint />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  const items = data?.items ?? [];
  const pending = items.filter((item) => item.status === "PENDING").length;
  const average = items.length ? (items.reduce((sum, item) => sum + Number(item.rating), 0) / items.length).toFixed(1) : "0.0";

  return <>
    <PageHeader eyebrow="Обратная связь" title="Отзывы клиентов" description="Публикуйте хорошие отзывы и скрывайте те, которые требуют уточнения." />
    <div className="stat-strip"><div className="small-stat"><span>Всего отзывов</span><strong>{items.length}</strong></div><div className="small-stat"><span>Средняя оценка</span><strong>{average} / 5</strong></div><div className="small-stat"><span>Ждут модерации</span><strong>{pending}</strong></div></div>
    <SectionCard title="Лента отзывов" subtitle="Статус публикации меняется одним нажатием">
      {items.length === 0 ? <EmptyState title="Отзывов пока нет" description="После завершённых визитов клиенты смогут поделиться впечатлениями." /> : <div className="review-admin-list">{items.map((item) => <article className="review-admin-card" key={item.id}><div className="review-admin-top"><div className="review-admin-client"><span className="review-admin-icon"><MessageSquareText size={16} /></span><div><strong>{item.clientName}</strong><small>{item.serviceName ?? "Приём"} · {formatDateTime(item.createdAt)}</small></div></div><StatusPill status={item.status.toLowerCase()} /></div><div className="review-admin-rating">{Array.from({ length: item.rating }).map((_, index) => <Star key={index} size={15} fill="currentColor" />)}<span>{item.rating}.0</span></div><p className="review-admin-text">{item.reviewText || "Без комментария"}</p><div className="review-admin-actions">{item.status !== "PUBLISHED" ? <button className="button button-secondary" onClick={() => void moderate(item.id, "PUBLISHED")}>Опубликовать</button> : null}{item.status !== "HIDDEN" ? <button className="button button-ghost danger-text" onClick={() => void moderate(item.id, "HIDDEN")}>Скрыть</button> : null}{item.status !== "PENDING" ? <button className="button button-ghost" onClick={() => void moderate(item.id, "PENDING")}>Вернуть на модерацию</button> : null}</div></article>)}</div>}
    </SectionCard>
  </>;
}
