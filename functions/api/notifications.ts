import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { json } from "../_lib/http";

type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  description: string;
  occurredAt: string;
  read: boolean;
  href: string | null;
};

const actionLabels: Record<string, string> = {
  CREATE: "Создано",
  UPDATE: "Изменено",
  ARCHIVE: "Архивировано",
  VOID: "Аннулировано",
  REFUND: "Возврат",
  CHECK_IN: "Отметка клиента",
  CALCULATE: "Зарплата рассчитана",
  CLOSE: "Период закрыт",
};

const entityLabels: Record<string, string> = {
  appointment: "Запись",
  client: "Клиент",
  payment: "Оплата",
  expense: "Расход",
  rent_payment: "Аренда",
  utility_payment: "Коммунальные услуги",
  payroll_period: "Зарплата",
  payroll_adjustment: "Корректировка зарплаты",
  employee: "Сотрудник",
  service: "Услуга",
  user: "Пользователь",
  settings: "Настройки",
};

function auditHref(entityType: string, entityId: string) {
  if (entityType === "client") return `/clients/${encodeURIComponent(entityId)}`;
  if (entityType === "appointment") return "/appointments";
  if (["payment", "expense", "rent_payment", "utility_payment"].includes(entityType)) return "/finance";
  if (["payroll_period", "payroll_adjustment"].includes(entityType)) return "/payroll";
  return null;
}

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "notifications.read")) return forbidden();

  const employee = user.role === "SPECIALIST"
    ? await env.DB.prepare("SELECT id FROM employees WHERE user_id = ? AND is_active = 1 LIMIT 1").bind(user.id).first<{ id: string }>()
    : null;
  const explicit = await env.DB.prepare(`
    SELECT n.id, n.kind, n.status, COALESCE(n.sent_at, n.scheduled_at, n.created_at) AS occurredAt,
      a.starts_at AS startsAt, c.full_name AS clientName,
      (SELECT s.name FROM appointment_services aps INNER JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id LIMIT 1) AS serviceName
    FROM notifications n
    LEFT JOIN appointments a ON a.id = n.appointment_id
    LEFT JOIN clients c ON c.id = n.client_id
    WHERE n.user_id = ? AND n.status <> 'CANCELLED'
    ORDER BY occurredAt DESC LIMIT 20
  `).bind(user.id).all<{ id: string; kind: string; status: string; occurredAt: string; startsAt: string | null; clientName: string | null; serviceName: string | null }>();

  const auditWhere = user.role === "SPECIALIST" ? "WHERE l.actor_id = ?" : "";
  const audit = await env.DB.prepare(`
    SELECT l.id, l.entity_type AS entityType, l.entity_id AS entityId, l.action,
      l.created_at AS occurredAt, u.name AS actorName
    FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
    ${auditWhere}
    ORDER BY l.created_at DESC LIMIT 20
  `).bind(...(user.role === "SPECIALIST" ? [user.id] : [])).all<{ id: string; entityType: string; entityId: string; action: string; occurredAt: string; actorName: string | null }>();

  const appointmentScope = user.role === "SPECIALIST" ? " AND a.employee_id = ?" : "";
  const appointmentBindings = user.role === "SPECIALIST" ? [employee?.id ?? "__none__"] : [];
  const upcoming = await env.DB.prepare(`
    SELECT a.id, a.starts_at AS startsAt, c.full_name AS clientName,
      e.full_name AS employeeName,
      (SELECT s.name FROM appointment_services aps INNER JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id LIMIT 1) AS serviceName
    FROM appointments a INNER JOIN clients c ON c.id = a.client_id
    LEFT JOIN employees e ON e.id = a.employee_id
    WHERE a.starts_at >= CURRENT_TIMESTAMP AND a.starts_at < datetime('now', '+48 hours')
      AND a.status IN ('SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_PROGRESS')${appointmentScope}
    ORDER BY a.starts_at ASC LIMIT 8
  `).bind(...appointmentBindings).all<{ id: string; startsAt: string; clientName: string; employeeName: string | null; serviceName: string | null }>();

  const obligations = user.role === "SPECIALIST"
    ? { results: [] as Array<{ id: string; kind: string; dueDate: string; amount: number }> }
    : await env.DB.prepare(`
      SELECT id, 'RENT' AS kind, due_date AS dueDate, amount FROM rent_payments
      WHERE status IN ('DUE', 'OVERDUE') OR (status <> 'PAID' AND due_date <= date('now', '+3 days'))
      UNION ALL
      SELECT id, 'UTILITIES' AS kind, due_date AS dueDate, amount FROM utility_payments
      WHERE status IN ('DUE', 'OVERDUE') OR (status <> 'PAID' AND due_date <= date('now', '+3 days'))
      ORDER BY dueDate ASC LIMIT 8
    `).all<{ id: string; kind: string; dueDate: string; amount: number }>();

  const explicitItems: NotificationItem[] = (explicit.results ?? []).map((item) => ({
    id: `notification-${item.id}`,
    kind: item.kind,
    title: item.kind === "REMINDER_24H" ? "Напоминание о визите завтра" : item.kind === "REMINDER_2H" ? "Напоминание о визите через 2 часа" : "Новое уведомление",
    description: [item.clientName, item.serviceName, item.startsAt].filter(Boolean).join(" · "),
    occurredAt: item.occurredAt,
    read: item.status !== "PENDING",
    href: item.startsAt ? "/appointments" : null,
  }));
  const auditItems: NotificationItem[] = (audit.results ?? []).map((item) => ({
    id: `audit-${item.id}`,
    kind: "AUDIT",
    title: `${entityLabels[item.entityType] ?? "Система"}: ${actionLabels[item.action] ?? item.action}`,
    description: item.actorName ? `Действие пользователя ${item.actorName}` : "Изменение сохранено в журнале",
    occurredAt: item.occurredAt,
    read: true,
    href: auditHref(item.entityType, item.entityId),
  }));
  const upcomingItems: NotificationItem[] = (upcoming.results ?? []).map((item) => ({
    id: `appointment-${item.id}`,
    kind: "UPCOMING_APPOINTMENT",
    title: "Ближайшая запись",
    description: [item.startsAt, item.clientName, item.serviceName, item.employeeName].filter(Boolean).join(" · "),
    occurredAt: item.startsAt,
    read: false,
    href: "/appointments",
  }));
  const obligationItems: NotificationItem[] = (obligations.results ?? []).map((item) => ({
    id: `obligation-${item.kind}-${item.id}`,
    kind: item.kind,
    title: item.kind === "RENT" ? "Платёж аренды требует внимания" : "Коммунальный платёж требует внимания",
    description: `${item.dueDate} · ${Number(item.amount ?? 0).toLocaleString("ru-RU")} ₸`,
    occurredAt: item.dueDate,
    read: false,
    href: "/finance",
  }));
  const items = [...explicitItems, ...upcomingItems, ...obligationItems, ...auditItems]
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
    .slice(0, 30);
  const unreadCount = [...explicitItems, ...upcomingItems, ...obligationItems].filter((item) => !item.read).length;
  return json({ ok: true, unreadCount, items });
};
