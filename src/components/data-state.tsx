import type { ReactNode } from "react";
import { AlertCircle, Database, LoaderCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui";

export function LoadingState({ label = "Загружаем данные…" }: { label?: string }) {
  return (
    <div className="data-state data-state-loading" role="status">
      <LoaderCircle className="spin" size={20} />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="data-state data-state-empty">
      <span className="data-state-icon"><Database size={20} /></span>
      <strong>{title}</strong>
      <span>{description}</span>
      {action ? <div className="data-state-action">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="data-state data-state-error">
      <span className="data-state-icon"><AlertCircle size={20} /></span>
      <strong>Не удалось загрузить данные</strong>
      <span>{message}</span>
      <Button variant="secondary" onClick={onRetry}><RefreshCw size={14} /> Повторить</Button>
    </div>
  );
}

export function Modal({ title, children, footer, onClose }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-panel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-heading"><div><p className="eyebrow">Новая запись в системе</p><h2>{title}</h2></div><button className="modal-close" onClick={onClose} aria-label="Закрыть">×</button></div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </section>
    </div>
  );
}

export function FormField({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`form-field ${className}`}><span>{label}</span>{children}</label>;
}

export function AuthHint() {
  return <EmptyState title="Доступ не подтверждён" description="Откройте podologymk внутри Telegram. Доступ появится только для Telegram ID, привязанного к системе." />;
}

export function isAuthError(message: string | null) {
  return Boolean(message && /авторизац|telegram authorization|доступ/i.test(message));
}
