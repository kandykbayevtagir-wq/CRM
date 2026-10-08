"use client";

import { useState } from "react";
import { MessageSquareText, Star } from "lucide-react";

import { apiFetch, dispatchCrmEvent } from "@/lib/api-client";
import { AuthHint, EmptyState, ErrorState, InlineError, isAuthError, LoadingState } from "@/components/data-state";
import { Button, PageHeader, SectionCard, StatusPill } from "@/components/ui";
import { formatDateTime, plural } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useCan } from "@/lib/current-user";

type AdminReview = { id: string; appointmentId: string; rating: number; reviewText: string | null; status: string; createdAt: string; clientName: string; serviceName: string | null };
type ReviewsResponse = { ok: true; items: AdminReview[] };
type ReviewStatus = "PUBLISHED" | "HIDDEN" | "PENDING";

export function ReviewsView() {
  const { data, loading, error, reload } = useApi<ReviewsResponse>("/api/reviews");
  const canModerate = useCan("reviews.write");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function moderate(id: string, status: ReviewStatus) {
    if (pendingId) return;
    setPendingId(id);
    setActionError(null);
    try {
      await apiFetch("/api/reviews", { method: "PATCH", body: { id, status } });
      dispatchCrmEvent("crm:data-changed");
      await reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Не удалось изменить статус отзыва");
    } finally {
      setPendingId(null);
    }
  }

  if (loading && !data) return <LoadingState />;
  if (error && isAuthError(error)) return <AuthHint />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  const items = data?.items ?? [];
  const pending = items.filter((item) => item.status === "PENDING").length;
  const average = items.length ? (items.reduce((sum, item) => sum + Number(item.rating), 0) / items.length).toFixed(1) : "0.0";

  return <>
    <PageHeader eyebrow="Обратная связь" title="Отзывы клиентов" description={canModerate ? "Публикуйте хорошие отзывы и скрывайте те, которые требуют уточнения." : "Отзывы клиентов о ваших приёмах."} />
    <div className="stat-strip"><div className="small-stat"><span>Всего отзывов</span><strong>{items.length}</strong></div><div className="small-stat"><span>Средняя оценка</span><strong>{average} / 5</strong></div><div className="small-stat"><span>Ждут модерации</span><strong>{pending}</strong></div></div>
    {actionError ? <InlineError>{actionError}</InlineError> : null}
    <SectionCard title="Лента отзывов" subtitle={canModerate ? "Статус публикации меняется одним нажатием" : plural(items.length, ["отзыв", "отзыва", "отзывов"])}>
      {items.length === 0 ? <EmptyState title="Отзывов пока нет" description="После завершённых визитов клиенты смогут поделиться впечатлениями." /> : <div className="review-admin-list">{items.map((item) => {
        const busy = pendingId === item.id;
        const rating = Math.max(0, Math.min(5, Math.round(Number(item.rating) || 0)));
        return <article className="review-admin-card" key={item.id} aria-busy={busy || undefined}>
          <div className="review-admin-top"><div className="review-admin-client"><span className="review-admin-icon"><MessageSquareText size={16} /></span><div><strong>{item.clientName}</strong><small>{item.serviceName ?? "Приём"} · {formatDateTime(item.createdAt)}</small></div></div><StatusPill status={item.status.toLowerCase()} /></div>
          <div className="review-admin-rating" aria-label={`Оценка ${rating} из 5`}>{Array.from({ length: rating }).map((_, index) => <Star key={index} size={15} fill="currentColor" aria-hidden="true" />)}<span>{rating}.0</span></div>
          <p className="review-admin-text">{item.reviewText || "Без комментария"}</p>
          {canModerate ? <div className="review-admin-actions">
            {item.status !== "PUBLISHED" ? <Button variant="secondary" loading={busy} disabled={Boolean(pendingId) && !busy} onClick={() => void moderate(item.id, "PUBLISHED")}>Опубликовать</Button> : null}
            {item.status !== "HIDDEN" ? <Button variant="ghost" className="danger-text" loading={busy} disabled={Boolean(pendingId) && !busy} onClick={() => void moderate(item.id, "HIDDEN")}>Скрыть</Button> : null}
            {item.status !== "PENDING" ? <Button variant="ghost" loading={busy} disabled={Boolean(pendingId) && !busy} onClick={() => void moderate(item.id, "PENDING")}>Вернуть на модерацию</Button> : null}
          </div> : null}
        </article>;
      })}</div>}
    </SectionCard>
  </>;
}
