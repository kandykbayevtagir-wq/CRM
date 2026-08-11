"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch, type ApiError } from "@/lib/api-client";

export function useApi<T>(path: string, initialData?: T, options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const [data, setData] = useState<T | undefined>(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) {
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
      if (requestId.current === currentRequest) setError(message.message || "Не удалось загрузить данные");
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
    window.addEventListener("crm:authenticated", handleRefresh);
    window.addEventListener("crm:data-changed", handleRefresh);
    void reload();
    return () => {
      abortRef.current?.abort();
      window.removeEventListener("crm:authenticated", handleRefresh);
      window.removeEventListener("crm:data-changed", handleRefresh);
    };
  }, [enabled, reload]);

  return { data, loading, error, reload };
}
