export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type ApiRequestInit = Omit<RequestInit, "body"> & { body?: BodyInit | Record<string, unknown> };

export async function apiFetch<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  let requestPath = path;
  if (typeof window !== "undefined" && (init.method ?? "GET").toUpperCase() === "GET" && path.startsWith("/api/") && window.localStorage.getItem("pmk_branch_id")) {
    const branchAware = ["/api/dashboard", "/api/appointments", "/api/finance", "/api/reports", "/api/payments", "/api/rent", "/api/utilities"];
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

  const response = await fetch(requestPath, {
    ...init,
    body,
    headers,
    credentials: "include",
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) {
    throw new ApiError(payload.error ?? "Не удалось выполнить запрос", response.status);
  }

  return payload;
}

export function dispatchCrmEvent(name: "crm:authenticated" | "crm:data-changed" | "crm:telegram-retry") {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(name));
}
