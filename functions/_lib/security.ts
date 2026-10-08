import { json } from "./http";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export function validateRequestOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin)) {
    throw new HttpError(403, "ORIGIN_REJECTED", "Запрос с другого сайта отклонён");
  }
}

export function errorResponse(error: unknown, requestId: string) {
  if (error instanceof HttpError) return json({ ok: false, code: error.code, error: error.message, requestId }, error.status);
  const message = error instanceof Error ? error.message : "";
  if (/CRM_DUPLICATE_PHONE/.test(message)) return json({ ok: false, code: "DUPLICATE_PHONE", error: "Этот номер уже используется другой карточкой клиента.", fieldErrors: { phone: "Этот номер уже используется" }, requestId }, 409);
  if (/CRM_SLOT_UNAVAILABLE/.test(message)) return json({ ok: false, code: "SLOT_UNAVAILABLE", error: "Это время уже занято. Выберите другое окно.", requestId }, 409);
  if (/CRM_VISIT_CLOSED/.test(message)) return json({ ok: false, code: "VISIT_CLOSED", error: "Завершённый приём зафиксирован. Используйте возврат или отдельную корректировку.", requestId }, 409);
  if (/CRM_INVALID_MONEY/.test(message)) return json({ ok: false, code: "INVALID_MONEY", error: "Укажите положительную сумму с точностью до тиына.", requestId }, 400);
  if (/CRM_LEDGER_IMMUTABLE/.test(message)) return json({ ok: false, code: "LEDGER_IMMUTABLE", error: "Проведённая операция зафиксирована. Используйте возврат или новую корректировку.", requestId }, 409);
  if (/CRM_STALE_WRITE|mutation_precondition/i.test(message)) return json({ ok: false, code: "STALE_WRITE", error: "Данные уже изменились. Обновите экран и повторите действие.", requestId }, 409);
  if (/CRM_PAYROLL_CLOSED/i.test(message)) return json({ ok: false, code: "PAYROLL_CLOSED", error: "Закрытый расчёт нельзя изменять. Добавьте корректировку в открытом периоде.", requestId }, 409);
  if (/CRM_INSUFFICIENT_STOCK/i.test(message)) return json({ ok: false, code: "INSUFFICIENT_STOCK", error: "Остаток изменился: материала недостаточно.", requestId }, 409);
  return json({ ok: false, code: "INTERNAL_ERROR", error: "Не удалось выполнить операцию. Повторите попытку.", requestId }, 500);
}
