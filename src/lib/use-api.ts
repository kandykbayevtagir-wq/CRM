"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch, type ApiError } from "@/lib/api-client";

export function useApi<T>(path: string, initialData?: T, options: { enabled?: boolean; refreshInterval?: number } = {}) {
  const enabled = options.enabled ?? true;
  const refreshInterval = options.refreshInterval ?? 0;
  const [data, setData] = useState<T | undefined>(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) {
      abortRef.current?.abort();
      requestId.current += 1;
      setData(undefined);
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    setLoading(true);
    setError(null);
    try {
      const nextData = await apiFetch<T>(path, { signal: controller.signal });
      if (requestId.current === currentRequest) setData(nextData);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      const message = cause as ApiError;
      if (requestId.current === currentRequest) {
        setError(message.message || "Не удалось загрузить данные");
        if (message.status === 401 || message.status === 403) setData(undefined);
      }
    } finally {
      if (requestId.current === currentRequest) setLoading(false);
    }
  }, [enabled, path]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const handleRefresh = () => void reload();
    const handleVisible = () => { if (document.visibilityState === "visible") void reload(); };
    window.addEventListener("online", handleRefresh);
    window.addEventListener("crm:authenticated", handleRefresh);
    window.addEventListener("crm:data-changed", handleRefresh);
    document.addEventListener("visibilitychange", handleVisible);
    const timer = refreshInterval > 0 ? window.setInterval(() => { if (document.visibilityState === "visible" && navigator.onLine) void reload(); }, refreshInterval) : null;
    void reload();
    return () => {
      abortRef.current?.abort();
      window.removeEventListener("online", handleRefresh);
      window.removeEventListener("crm:authenticated", handleRefresh);
      window.removeEventListener("crm:data-changed", handleRefresh);
      document.removeEventListener("visibilitychange", handleVisible);
      if (timer !== null) window.clearInterval(timer);
    };
  }, [enabled, reload, refreshInterval]);

  return { data, loading, error, reload };
}
