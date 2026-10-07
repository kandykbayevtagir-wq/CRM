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

export function Modal({ title, children, footer, onClose }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void }) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previousActive = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const dialog = dialogRef.current;
    dialog?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => panel ? Array.from(panel.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])")).filter((element) => !element.hasAttribute("disabled")) : [];
    (panel?.querySelector<HTMLElement>("[autofocus]") ?? focusable().find((element) => element.matches("input, select, textarea")) ?? focusable()[0])?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); dialog?.close(); document.body.style.overflow = overflow; previousActive?.focus(); };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog ref={dialogRef} className="crm-dialog" onCancel={(event) => { event.preventDefault(); closeRef.current(); }} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-heading"><div><p className="eyebrow">podologymk</p><h2 id={titleId}>{title}</h2></div><button className="modal-close" onClick={onClose} aria-label="Закрыть">×</button></div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </section>
    </dialog>, document.body
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
