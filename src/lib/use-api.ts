"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch, type ApiError } from "@/lib/api-client";

export function useApi<T>(path: string, initialData?: T, options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const [data, setData] = useState<T | undefined>(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setData(await apiFetch<T>(path));
    } catch (cause) {
      const message = cause as ApiError;
      setError(message.message || "Не удалось загрузить данные");
    } finally {
      setLoading(false);
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
      window.removeEventListener("crm:authenticated", handleRefresh);
      window.removeEventListener("crm:data-changed", handleRefresh);
    };
  }, [enabled, reload]);

  return { data, loading, error, reload };
}
