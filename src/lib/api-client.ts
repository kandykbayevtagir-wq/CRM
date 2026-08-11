export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors: Record<string, string>;
  readonly code: string | null;

  constructor(message: string, status: number, fieldErrors: Record<string, string> = {}, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.code = code;
  }
}

function humanizeApiError(status: number, message: string, code: string | null) {
  if (code === "SLOT_UNAVAILABLE") return "Это время только что заняли. Мы обновим свободные окна — выберите другое.";
  if (status === 401) return "Авторизация Telegram истекла. Откройте Mini App заново через Telegram.";
  if (code === "WAITLIST_DUPLICATE") return "Вы уже добавлены в лист ожидания на этот запрос.";
  if (status === 403) return "Для этого действия нет доступа.";
  if (status >= 500 || /sqlite|constraint|invalid payload|internal server/i.test(message)) return "Что-то пошло не так. Попробуйте ещё раз.";
  return message;
}

type ApiRequestInit = Omit<RequestInit, "body"> & { body?: BodyInit | Record<string, unknown> };

export async function apiFetch<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  let requestPath = path;
  if (typeof window !== "undefined" && (init.method ?? "GET").toUpperCase() === "GET" && path.startsWith("/api/") && window.localStorage.getItem("pmk_branch_id")) {
      const branchAware = ["/api/dashboard", "/api/appointments", "/api/finance", "/api/reports", "/api/pnl", "/api/kpi", "/api/goals", "/api/inventory", "/api/purchases", "/api/tasks", "/api/payments", "/api/rent", "/api/utilities"];
    if (branchAware.some((prefix) => path.startsWith(prefix))) {
      const url = new URL(path, window.location.origin);
      if (!url.searchParams.has("branchId")) url.searchParams.set("branchId", window.localStorage.getItem("pmk_branch_id") ?? "");
      requestPath = `${url.pathname}${url.search}`;
    }
  }

  let body = init.body;
  if (body && typeof body !== "string" && !(body instanceof FormData)) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(requestPath, {
      ...init,
      body,
      headers,
      credentials: "include",
      cache: "no-store",
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError("Не удалось подключиться. Проверьте интернет и попробуйте ещё раз.", 0);
  }

  const payload = (await response.json().catch(() => ({}))) as { error?: string; fieldErrors?: Record<string, string>; code?: string } & T;
  if (!response.ok) {
    const rawMessage = payload.error ?? "Не удалось выполнить запрос";
    throw new ApiError(humanizeApiError(response.status, rawMessage, payload.code ?? null), response.status, payload.fieldErrors ?? {}, payload.code ?? null);
  }

  return payload;
}

export function dispatchCrmEvent(name: "crm:authenticated" | "crm:data-changed" | "crm:telegram-retry") {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(name));
}
