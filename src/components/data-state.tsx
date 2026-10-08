"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Database, LoaderCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui";
import { dispatchCrmEvent } from "@/lib/api-client";

export function LoadingState({ label = "Загружаем данные…" }: { label?: string }) {
  return (
    <div className="data-state data-state-loading" role="status" aria-live="polite" aria-busy="true">
      <div className="skeleton-preview" aria-hidden="true"><i /><i /><i /></div>
      <span><LoaderCircle className="spin" size={16} /> {label}</span>
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

/**
 * Native <dialog>.showModal() provides the top layer, focus containment and Escape handling.
 * `busy` keeps the dialog open while a request is in flight so a double tap cannot dismiss it.
 */
export function Modal({ title, children, footer, onClose, busy = false }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; busy?: boolean }) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => { closeRef.current = onClose; busyRef.current = busy; }, [onClose, busy]);
  useEffect(() => {
    const previousActive = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = panel ? Array.from(panel.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])")).filter((element) => !element.hasAttribute("disabled")) : [];
    (focusable.find((element) => element.matches("input, select, textarea")) ?? focusable[0])?.focus();
    return () => { if (dialog?.open) dialog.close(); document.body.style.overflow = overflow; previousActive?.focus(); };
  }, []);
  if (typeof document === "undefined") return null;
  const requestClose = () => { if (!busyRef.current) closeRef.current(); };
  return createPortal(
    <dialog ref={dialogRef} className="crm-dialog" aria-labelledby={titleId} aria-busy={busy || undefined} onCancel={(event) => { event.preventDefault(); requestClose(); }} onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <section ref={panelRef} className="modal-panel">
        <div className="modal-heading"><div><p className="eyebrow">podologymk</p><h2 id={titleId}>{title}</h2></div><button type="button" className="modal-close" onClick={requestClose} disabled={busy} aria-label="Закрыть">×</button></div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </section>
    </dialog>, document.body
  );
}

/** Replacement for window.confirm(): Telegram WebViews suppress native dialogs, so confirmations render in-app. */
export function ConfirmDialog({ title, description, confirmLabel = "Подтвердить", cancelLabel = "Отмена", danger = false, pending = false, error, onConfirm, onClose, children }: {
  title: string; description?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; pending?: boolean; error?: string | null; onConfirm: () => void; onClose: () => void; children?: ReactNode;
}) {
  return (
    <Modal title={title} onClose={onClose} busy={pending} footer={<><Button variant="secondary" onClick={onClose} disabled={pending}>{cancelLabel}</Button><Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={pending}>{confirmLabel}</Button></>}>
      {description ? <p className="modal-intro">{description}</p> : null}
      {children}
      {error ? <InlineError>{error}</InlineError> : null}
    </Modal>
  );
}

export function FormField({ label, children, className = "", error, hint, errorId }: { label: string; children: ReactNode; className?: string; error?: string; hint?: string; errorId?: string }) {
  return <label className={`form-field ${className} ${error ? "form-field-invalid" : ""}`}><span>{label}</span>{children}{hint ? <small className="field-hint">{hint}</small> : null}{error ? <small id={errorId} className="field-error" role="alert">{error}</small> : null}</label>;
}

export function InlineError({ children }: { children: ReactNode }) {
  return <p className="form-error" role="alert">{children}</p>;
}

export function AuthHint() {
  return <EmptyState title="Не удалось подтвердить Telegram" description="Откройте Mini App через кнопку бота. Если вы уже внутри Telegram, нажмите повторную проверку — соединение и Telegram ID будут запрошены заново." action={<Button variant="secondary" onClick={() => dispatchCrmEvent("crm:telegram-retry")}><RefreshCw size={14} /> Повторить проверку</Button>} />;
}

export function isAuthError(message: string | null) {
  return Boolean(message && /авторизац|telegram authorization|telegram data|пользователь не приглашён|учётная запись деактивирована/i.test(message));
}
