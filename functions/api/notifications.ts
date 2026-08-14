import { forbidden, getSessionUser, hasCrmPermission, unauthorized } from "../_lib/auth";
import type { CrmEnv } from "../_lib/env";
import { json, readJson, stringValue } from "../_lib/http";

type NotificationItem = { id: string; kind: string; title: string; description: string; occurredAt: string; read: boolean; href: string | null };

const actionLabels: Record<string, string> = { CREATE: "Создано", UPDATE: "Изменено", ARCHIVE: "Архивировано", VOID: "Аннулировано", REFUND: "Возврат", CHECK_IN: "Отметка клиента", CALCULATE: "Зарплата рассчитана", CLOSE: "Период закрыт", RECEIVE: "Приход принят" };
const entityLabels: Record<string, string> = { appointment: "Запись", client: "Клиент", payment: "Оплата", expense: "Расход", rent_payment: "Аренда", utility_payment: "Коммунальные услуги", payroll_period: "Зарплата", payroll_adjustment: "Корректировка зарплаты", employee: "Сотрудник", service: "Услуга", product: "Товар", purchase: "Закупка", task: "Задача", follow_up: "Повторный визит", settings: "Настройки" };

function auditHref(entityType: string, entityId: string) {
  if (entityType === "client") return `/clients/${encodeURIComponent(entityId)}`;
  if (entityType === "appointment") return "/appointments";
  if (["payment", "expense", "rent_payment", "utility_payment"].includes(entityType)) return "/finance";
  if (["payroll_period", "payroll_adjustment"].includes(entityType)) return "/payroll";
  if (["product", "purchase", "stock_movement"].includes(entityType)) return "/inventory";
  if (entityType === "task") return "/tasks";
  return null;
}

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "notifications.read")) return forbidden();
  const employee = user.role === "SPECIALIST" ? await env.DB.prepare("SELECT id FROM employees WHERE user_id = ? AND is_active = 1 LIMIT 1").bind(user.id).first<{ id: string }>() : null;
  const readRows = await env.DB.prepare("SELECT notification_key AS notificationKey FROM notification_reads WHERE user_id = ?").bind(user.id).all<{ notificationKey: string }>();
  const readKeys = new Set((readRows.results ?? []).map((row) => row.notificationKey));
  const [explicit, audit, upcoming, obligations, lowStock, overdueTasks, followUps, inventoryIssues, failedOutbox, unpaidAppointments] = await Promise.all([
    env.DB.prepare(`SELECT n.id, n.kind, n.status, n.read_at AS readAt, COALESCE(n.sent_at, n.scheduled_at, n.created_at) AS occurredAt, a.starts_at AS startsAt, c.full_name AS clientName, (SELECT s.name FROM appointment_services aps INNER JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id LIMIT 1) AS serviceName FROM notifications n LEFT JOIN appointments a ON a.id = n.appointment_id LEFT JOIN clients c ON c.id = n.client_id WHERE n.user_id = ? AND n.status <> 'CANCELLED' ORDER BY occurredAt DESC LIMIT 20`).bind(user.id).all<{ id: string; kind: string; status: string; readAt: string | null; occurredAt: string; startsAt: string | null; clientName: string | null; serviceName: string | null }>(),
    env.DB.prepare(`SELECT l.id, l.entity_type AS entityType, l.entity_id AS entityId, l.action, l.created_at AS occurredAt, u.name AS actorName FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id ${user.role === "SPECIALIST" ? "WHERE l.actor_id = ?" : ""} ORDER BY l.created_at DESC LIMIT 20`).bind(...(user.role === "SPECIALIST" ? [user.id] : [])).all<{ id: string; entityType: string; entityId: string; action: string; occurredAt: string; actorName: string | null }>(),
    env.DB.prepare(`SELECT a.id, a.starts_at AS startsAt, c.full_name AS clientName, e.full_name AS employeeName, (SELECT s.name FROM appointment_services aps INNER JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id LIMIT 1) AS serviceName FROM appointments a INNER JOIN clients c ON c.id = a.client_id LEFT JOIN employees e ON e.id = a.employee_id WHERE a.starts_at >= CURRENT_TIMESTAMP AND a.starts_at < datetime('now', '+48 hours') AND a.status IN ('SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_PROGRESS')${user.role === "SPECIALIST" ? " AND a.employee_id = ?" : ""} ORDER BY a.starts_at ASC LIMIT 8`).bind(...(user.role === "SPECIALIST" ? [employee?.id ?? "__none__"] : [])).all<{ id: string; startsAt: string; clientName: string; employeeName: string | null; serviceName: string | null }>(),
    user.role === "SPECIALIST" ? Promise.resolve({ results: [] as Array<{ id: string; kind: string; dueDate: string; amount: number }> }) : env.DB.prepare(`SELECT id, 'RENT' AS kind, due_date AS dueDate, amount FROM rent_payments WHERE status IN ('DUE', 'OVERDUE') OR (status <> 'PAID' AND due_date <= date('now', '+3 days')) UNION ALL SELECT id, 'UTILITIES' AS kind, due_date AS dueDate, amount FROM utility_payments WHERE status IN ('DUE', 'OVERDUE') OR (status <> 'PAID' AND due_date <= date('now', '+3 days')) ORDER BY dueDate ASC LIMIT 8`).all<{ id: string; kind: string; dueDate: string; amount: number }>(),
    env.DB.prepare(`SELECT p.id, p.name, COALESCE(SUM(CASE WHEN sm.direction = 'IN' THEN sm.quantity ELSE -sm.quantity END), 0) AS currentStock, p.min_stock AS minStock FROM products p LEFT JOIN stock_movements sm ON sm.product_id = p.id WHERE ${user.role === "SPECIALIST" ? "0" : "p.is_active = 1"} GROUP BY p.id HAVING currentStock <= p.min_stock ORDER BY p.name LIMIT 8`).all<{ id: string; name: string; currentStock: number; minStock: number }>(),
    env.DB.prepare(`SELECT id, title, due_date AS dueDate FROM tasks WHERE status IN ('OPEN', 'IN_PROGRESS') AND due_date < CURRENT_TIMESTAMP${user.role === "SPECIALIST" ? " AND assignee_id = ?" : ""} ORDER BY due_date LIMIT 8`).bind(...(user.role === "SPECIALIST" ? [user.id] : [])).all<{ id: string; title: string; dueDate: string }>(),
    env.DB.prepare(`SELECT f.id, f.recommended_date AS recommendedDate, c.full_name AS clientName FROM follow_ups f INNER JOIN clients c ON c.id = f.client_id LEFT JOIN appointments a ON a.id = f.appointment_id WHERE f.status = 'OPEN' AND f.recommended_date <= date('now', '+7 days')${user.role === "SPECIALIST" ? " AND a.employee_id = ?" : ""} ORDER BY f.recommended_date LIMIT 8`).bind(...(user.role === "SPECIALIST" ? [employee?.id ?? "__none__"] : [])).all<{ id: string; recommendedDate: string; clientName: string }>(),
    env.DB.prepare(`SELECT id, message, created_at AS createdAt FROM inventory_issues WHERE ${user.role === "SPECIALIST" ? "0" : "status = 'OPEN'"} ORDER BY created_at DESC LIMIT 8`).all<{ id: string; message: string; createdAt: string }>(),
    env.DB.prepare(`SELECT id, last_error AS lastError, updated_at AS updatedAt FROM message_outbox WHERE ${user.role === "SPECIALIST" ? "0" : "status = 'FAILED'"} ORDER BY updated_at DESC LIMIT 8`).all<{ id: string; lastError: string | null; updatedAt: string }>(),
    env.DB.prepare(`SELECT a.id, a.starts_at AS startsAt, c.full_name AS clientName, a.total_amount AS totalAmount, COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.appointment_id = a.id AND p.payment_status = 'POSTED'), 0) - COALESCE((SELECT SUM(pa.amount) FROM payment_adjustments pa INNER JOIN payments rp ON rp.id = pa.payment_id WHERE rp.appointment_id = a.id), 0) AS paidAmount FROM appointments a INNER JOIN clients c ON c.id = a.client_id WHERE ${user.role === "SPECIALIST" ? "0" : "a.status = 'COMPLETED' AND a.total_amount > (COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.appointment_id = a.id AND p.payment_status = 'POSTED'), 0) - COALESCE((SELECT SUM(pa.amount) FROM payment_adjustments pa INNER JOIN payments rp ON rp.id = pa.payment_id WHERE rp.appointment_id = a.id), 0))"} ORDER BY a.starts_at DESC LIMIT 8`).all<{ id: string; startsAt: string; clientName: string; totalAmount: number; paidAmount: number }>(),
  ]);
  const explicitItems: NotificationItem[] = (explicit.results ?? []).map((item) => ({ id: `notification-${item.id}`, kind: item.kind, title: item.kind === "REMINDER_24H" ? "Напоминание о визите завтра" : item.kind === "REMINDER_2H" ? "Напоминание о визите через 2 часа" : "Новое уведомление", description: [item.clientName, item.serviceName, item.startsAt].filter(Boolean).join(" · "), occurredAt: item.occurredAt, read: Boolean(item.readAt) || readKeys.has(`notification-${item.id}`), href: item.startsAt ? "/appointments" : null }));
  const auditItems: NotificationItem[] = (audit.results ?? []).map((item) => ({ id: `audit-${item.id}`, kind: "AUDIT", title: `${entityLabels[item.entityType] ?? "Система"}: ${actionLabels[item.action] ?? item.action}`, description: item.actorName ? `Действие пользователя ${item.actorName}` : "Изменение сохранено в журнале", occurredAt: item.occurredAt, read: true, href: auditHref(item.entityType, item.entityId) }));
  const upcomingItems: NotificationItem[] = (upcoming.results ?? []).map((item) => ({ id: `appointment-${item.id}`, kind: "UPCOMING_APPOINTMENT", title: "Ближайшая запись", description: [item.startsAt, item.clientName, item.serviceName, item.employeeName].filter(Boolean).join(" · "), occurredAt: item.startsAt, read: readKeys.has(`appointment-${item.id}`), href: "/appointments" }));
  const obligationItems: NotificationItem[] = (obligations.results ?? []).map((item) => ({ id: `obligation-${item.kind}-${item.id}`, kind: item.kind, title: item.kind === "RENT" ? "Платёж аренды требует внимания" : "Коммунальный платёж требует внимания", description: `${item.dueDate} · ${Number(item.amount ?? 0).toLocaleString("ru-RU")} ₸`, occurredAt: item.dueDate, read: readKeys.has(`obligation-${item.kind}-${item.id}`), href: "/finance" }));
  const operationalItems: NotificationItem[] = [
    ...(lowStock.results ?? []).map((item) => ({ id: `low-stock-${item.id}`, kind: "LOW_STOCK", title: "Низкий остаток", description: `${item.name}: доступно ${Number(item.currentStock ?? 0)} при минимуме ${Number(item.minStock ?? 0)}`, occurredAt: new Date().toISOString(), read: readKeys.has(`low-stock-${item.id}`), href: "/inventory" })),
    ...(overdueTasks.results ?? []).map((item) => ({ id: `task-${item.id}`, kind: "OVERDUE_TASK", title: "Просроченная задача", description: `${item.title} · ${item.dueDate}`, occurredAt: item.dueDate, read: readKeys.has(`task-${item.id}`), href: "/tasks" })),
    ...(followUps.results ?? []).map((item) => ({ id: `follow-up-${item.id}`, kind: "FOLLOW_UP", title: "Нужен повторный визит", description: `${item.clientName} · ${item.recommendedDate}`, occurredAt: item.recommendedDate, read: readKeys.has(`follow-up-${item.id}`), href: "/retention" })),
    ...(inventoryIssues.results ?? []).map((item) => ({ id: `inventory-issue-${item.id}`, kind: "INVENTORY_ISSUE", title: "Проблема списания", description: item.message, occurredAt: item.createdAt, read: readKeys.has(`inventory-issue-${item.id}`), href: "/inventory" })),
    ...(failedOutbox.results ?? []).map((item) => ({ id: `outbox-${item.id}`, kind: "TELEGRAM_FAILED", title: "Ошибка Telegram-уведомления", description: item.lastError ?? "Сообщение не доставлено", occurredAt: item.updatedAt, read: readKeys.has(`outbox-${item.id}`), href: "/settings" })),
    ...(unpaidAppointments.results ?? []).map((item) => ({ id: `unpaid-${item.id}`, kind: "UNPAID_APPOINTMENT", title: "Остаток по оплате", description: `${item.clientName} · осталось ${Math.max(0, Number(item.totalAmount ?? 0) - Number(item.paidAmount ?? 0)).toLocaleString("ru-RU")} ₸`, occurredAt: item.startsAt, read: readKeys.has(`unpaid-${item.id}`), href: "/finance" })),
  ];
  const items = [...explicitItems, ...upcomingItems, ...obligationItems, ...operationalItems, ...auditItems].sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()).slice(0, 40);
  return json({ ok: true, unreadCount: items.filter((item) => !item.read).length, items });
};

export const onRequestPost: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!hasCrmPermission(user, "notifications.write")) return forbidden();
  const body = await readJson(request);
  const keys = Array.isArray(body.notificationKeys) ? body.notificationKeys.filter((key): key is string => typeof key === "string" && key.length <= 200) : [stringValue(body, "notificationKey")].filter(Boolean);
  if (!keys.length) return json({ ok: true });
  await env.DB.batch(keys.map((key) => env.DB.prepare("INSERT INTO notification_reads (user_id, notification_key) VALUES (?, ?) ON CONFLICT(user_id, notification_key) DO UPDATE SET read_at = CURRENT_TIMESTAMP").bind(user.id, key)));
  return json({ ok: true, read: keys.length });
};
