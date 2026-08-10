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

  let body = init.body;
  if (body && typeof body !== "string" && !(body instanceof FormData)) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(body);
  }

  const response = await fetch(path, {
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

export function dispatchCrmEvent(name: "crm:authenticated" | "crm:data-changed") {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(name));
}
