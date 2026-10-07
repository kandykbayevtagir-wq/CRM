import type { ReactNode, ButtonHTMLAttributes } from "react";
import { ArrowDownRight, ArrowUpRight, LoaderCircle } from "lucide-react";

import { formatCurrency } from "@/lib/format";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  type = "button",
  onClick,
  disabled = false,
  loading = false,
  className = "",
  ...props
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  type?: "button" | "submit" | "reset";
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  return (
    <button {...props} className={`button button-${variant} ${className}`} type={type} onClick={onClick} disabled={disabled || loading} aria-busy={loading || undefined}>
      {loading ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function SectionCard({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`section-card ${className}`}>
      <div className="section-card-heading">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action ? <div>{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  change,
  trend,
  tone,
}: {
  label: string;
  value: string;
  change: string;
  trend: "up" | "down" | "neutral";
  tone: string;
}) {
  return (
    <div className={`metric-card metric-${tone}`}>
      <div className="metric-card-top">
        <span>{label}</span>
        <span className="metric-dot" />
      </div>
      <strong>{value}</strong>
      <div className={`metric-change metric-change-${trend}`}>
        {trend === "up" ? <ArrowUpRight size={15} /> : trend === "down" ? <ArrowDownRight size={15} /> : null}
        <span>{change}</span>
        {trend !== "neutral" ? <span className="metric-period">к предыдущему периоду</span> : null}
      </div>
    </div>
  );
}

const statusLabels: Record<string, string> = {
  scheduled: "Запланирован",
  confirmed: "Подтверждён",
  arrived: "Пришёл",
  in_progress: "В работе",
  completed: "Завершён",
  cancelled: "Отменён",
  no_show: "Неявка",
  active: "Активный",
  new: "Новый",
  inactive: "Неактивный",
  paid: "Оплачено",
  planned: "Запланировано",
  due: "К оплате",
  overdue: "Просрочено",
  draft: "Черновик",
  calculated: "Рассчитан",
  closed: "Закрыт",
  pending: "На модерации",
  queued: "В очереди",
  published: "Опубликован",
  hidden: "Скрыт",
  archived: "В архиве", open: "Открыта", done: "Выполнена", ordered: "Заказано",
  partially_received: "Частично получено", received: "Получено", processing: "Отправляется",
  sent: "Отправлено", failed: "Ошибка", resolved: "Решено", ignored: "Пропущено", booked: "Записан",
  low: "Низкий", normal: "Обычный", high: "Высокий", urgent: "Срочно", posted: "Проведено",
};

export function StatusPill({ status }: { status: string }) {
  const key = status.toLowerCase();
  return <span className={`status-pill status-${key}`}>{statusLabels[key] ?? status}</span>;
}

export function Amount({ value, muted = false }: { value: number; muted?: boolean }) {
  return <span className={muted ? "amount amount-muted" : "amount"}>{formatCurrency(value)}</span>;
}

export function Avatar({ initials, tone = "violet" }: { initials: string; tone?: string }) {
  return <span className={`avatar avatar-${tone}`}>{initials}</span>;
}

export function FilterSelect({ label, value }: { label: string; value: string }) {
  return (
    <label className="filter-select">
      <span>{label}</span>
      <select defaultValue={value} aria-label={label}>
        <option>{value}</option>
      </select>
    </label>
  );
}
