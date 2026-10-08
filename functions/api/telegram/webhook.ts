import type { CrmEnv } from "../../_lib/env";
import type { AuthUser } from "../../_lib/auth";
import { json, readJson, newId } from "../../_lib/http";
import { telegramApi } from "../../_lib/telegram-bot";
import { processOutbox } from "../../_lib/notification-delivery";
import { auditStatement } from "../../_lib/audit";
import { assertUnchanged } from "../../_lib/transaction";
import { hasPermission } from "../../../src/lib/permissions";
import { isStaffTelegramAllowed } from "../../../src/lib/auth/bootstrap";
import { localDate, localDayRange } from "../../../src/lib/appointments/schedule";

type Sender = { id?: number; first_name?: string };
type Message = { chat?: { id?: number; type?: string }; text?: string; from?: Sender };
type Callback = { id?: string; data?: string; from?: Sender; message?: Message };
type Update = { update_id?: number; message?: Message; callback_query?: Callback };
type Button = { text: string; web_app?: { url: string }; callback_data?: string };

export function botCommand(text: string) {
  return text.trim().split(/\s+/)[0].split("@")[0].toLowerCase();
}

export const onRequestPost: PagesFunction<CrmEnv> = async (context) => {
  const { request, env } = context;
  if (!env.TELEGRAM_WEBHOOK_SECRET || request.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET) return json({ ok: false }, 403);
  const update = await readJson(request) as Update;
  if (!Number.isSafeInteger(update.update_id) || Number(update.update_id) < 0) return json({ ok: false }, 400);
  const callback = update.callback_query;
  // Stop the Telegram button spinner immediately; the business reply is durable.
  if (callback?.id) context.waitUntil(telegramApi(env, "answerCallbackQuery", { callback_query_id: callback.id }).catch(() => undefined));
  if (await env.DB.prepare("SELECT update_id FROM telegram_updates WHERE update_id = ?").bind(update.update_id).first()) return json({ ok: true });
  const message = callback?.message ?? update.message;
  const sender = callback?.from ?? update.message?.from;
  if (!sender?.id || !message?.chat?.id || message.chat.type !== "private" || sender.id !== message.chat.id) {
    await env.DB.prepare("INSERT OR IGNORE INTO telegram_updates(update_id) VALUES (?)").bind(update.update_id).run();
    return json({ ok: true });
  }
  const telegramId = String(sender.id);
  const user = await env.DB.prepare("SELECT id, name, role, active, client_id AS clientId, telegram_id AS telegramId FROM users WHERE telegram_id = ?")
    .bind(telegramId).first<AuthUser>();
  const allowedIds = (env.CRM_ALLOWED_TELEGRAM_IDS || "").split(",").map((value) => value.trim());
  const allowed = !user || (user.active === 1 && isStaffTelegramAllowed(user.role, telegramId, allowedIds, env.CRM_OWNER_TELEGRAM_ID || ""));
  const base = (env.MINI_APP_URL || "https://podologymk-crm.pages.dev").replace(/\/$/, "");
  const appButton = (text: string, path: string): Button => ({ text, web_app: { url: base + path } });
  let rows: Button[][] = [[appButton("Записаться", "/client/book")], [appButton("Мои записи", "/client/appointments"), appButton("Профиль", "/client/profile")]];
  let text = "Добро пожаловать в podologymk! Выберите действие.";
  let requiredPermission: string | null = null;
  const statements: D1PreparedStatement[] = [env.DB.prepare("INSERT INTO telegram_updates(update_id) VALUES (?)").bind(update.update_id)];
  if (!allowed) {
    text = "Доступ к учётной записи отключён. Свяжитесь с администратором центра.";
    rows = [];
  } else if (callback?.data) {
    const [action, id] = callback.data.split(":");
    if (!["confirm", "cancel", "cancel_yes"].includes(action) || !id || !user?.clientId || user.role !== "CLIENT") {
      text = "Это действие недоступно. Откройте свои записи в личном кабинете.";
    } else {
      const appointment = await env.DB.prepare("SELECT id, revision, status, starts_at AS startsAt FROM appointments WHERE id = ? AND client_id = ?")
        .bind(id, user.clientId).first<{ id: string; revision: number; status: string; startsAt: string }>();
      const settings = await env.DB.prepare("SELECT cancellation_window_hours AS hours FROM organization_settings WHERE id = 1").first<{ hours: number }>();
      const cancellable = appointment && ["SCHEDULED", "CONFIRMED"].includes(appointment.status) && Date.parse(appointment.startsAt) > Date.now() + Number(settings?.hours ?? 2) * 3600000;
      if (!appointment) text = "Запись не найдена в вашем профиле.";
      else if (action === "confirm" && appointment.status === "CONFIRMED") text = "Ваш визит уже подтверждён. До встречи!";
      else if (action === "confirm" && appointment.status === "SCHEDULED" && Date.parse(appointment.startsAt) > Date.now()) {
        statements.push(...assertUnchanged(env.DB, "appointments", id, appointment.revision),
          env.DB.prepare("UPDATE appointments SET status = 'CONFIRMED', confirmed_at = CURRENT_TIMESTAMP, changed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(user.id, id),
          env.DB.prepare("INSERT INTO appointment_status_history(id, appointment_id, from_status, to_status, actor_id, note) VALUES(?, ?, 'SCHEDULED', 'CONFIRMED', ?, 'Подтверждено клиентом в боте')").bind(newId(), id, user.id),
          auditStatement(env.DB, user, "appointment", id, "CONFIRM", { status: appointment.status }, { status: "CONFIRMED" }));
        text = "Визит подтверждён. До встречи!";
      } else if (action === "cancel" && cancellable) {
        text = "Отменить этот визит? Освободившееся время сможет занять другой клиент.";
        rows = [[{ text: "Да, отменить визит", callback_data: "cancel_yes:" + id }], [appButton("Сохранить запись / перенести", "/client/appointments")]];
      } else if (action === "cancel_yes" && cancellable) {
        statements.push(...assertUnchanged(env.DB, "appointments", id, appointment.revision),
          env.DB.prepare("UPDATE appointments SET status = 'CANCELLED', cancel_reason = 'Отменено клиентом в боте', cancelled_at = CURRENT_TIMESTAMP, changed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(user.id, id),
          env.DB.prepare("DELETE FROM appointment_slot_reservations WHERE appointment_id = ?").bind(id),
          env.DB.prepare("UPDATE notifications SET status = 'CANCELLED' WHERE appointment_id = ? AND status = 'PENDING'").bind(id),
          env.DB.prepare("INSERT INTO appointment_status_history(id, appointment_id, from_status, to_status, actor_id, note) VALUES(?, ?, ?, 'CANCELLED', ?, 'Отмена через Telegram')").bind(newId(), id, appointment.status, user.id),
          auditStatement(env.DB, user, "appointment", id, "CANCEL", { status: appointment.status }, { status: "CANCELLED" }));
        text = "Визит отменён. Вы можете выбрать новое удобное время.";
      } else text = "Статус записи изменился или до визита осталось слишком мало времени. Для изменений свяжитесь с администратором.";
    }
  } else {
    const command = botCommand(message.text || "");
    const staff = user && user.role !== "CLIENT";
    if (staff) rows = [[appButton("Сегодня", "/today"), appButton("Записи", "/appointments")], [appButton("Открыть CRM", "/")]];
    if (command === "/help") text = staff
      ? "Откройте CRM для работы с записями. /today — приёмы сегодня, /appointments — календарь, /contact — контакты центра. Доступ определяется вашей ролью."
      : "Запись: /book. Ближайшие визиты: /appointments. Бонусы: /bonuses. Профиль: /profile. Связь с центром: /contact. В личном кабинете доступны перенос, отмена и отзывы.";
    else if (command === "/book") { text = "Выберите услугу и свободное время в личном кабинете."; rows = [[appButton("Записаться", staff ? "/appointments" : "/client/book")]]; }
    else if (command === "/profile" || command === "/bonuses" || command === "/loyalty") {
      text = command === "/profile" ? "Ваш профиль и настройки напоминаний." : "Баланс и история начислений доступны в личном кабинете.";
      rows = [[appButton("Открыть", staff ? "/" : command === "/profile" ? "/client/profile" : "/client/loyalty")]];
    } else if (command === "/contact") {
      const branches = await env.DB.prepare("SELECT name, address, phone FROM branches WHERE is_active = 1 ORDER BY name LIMIT 8").all<{ name: string; address: string | null; phone: string | null }>();
      text = "Связь с центром:\n\n" + (branches.results ?? []).map((branch) => [branch.name, branch.address, branch.phone].filter(Boolean).join("\n")).join("\n\n");
      if (!(branches.results ?? []).length) text = "Контакты центра уточняются. Откройте личный кабинет.";
    } else if (["/appointments", "/my_appointments", "/today"].includes(command)) {
      if (staff && !hasPermission(user.role, "appointments.read")) text = "Ваша роль не имеет доступа к записям клиентов. Откройте доступные разделы CRM.";
      else {
        const timezoneRow = await env.DB.prepare("SELECT timezone FROM organization_settings WHERE id = 1").first<{ timezone: string }>();
        const timezone = timezoneRow?.timezone || "Asia/Almaty";
        const filters = staff ? ["a.status NOT IN ('CANCELLED', 'NO_SHOW')"] : ["a.client_id = ?", "a.status IN ('SCHEDULED', 'CONFIRMED')", "julianday(a.starts_at) > julianday('now')"];
        const bindings: string[] = staff ? [] : [user?.clientId ?? "__none__"];
        if (staff) {
          requiredPermission = "appointments.read";
          const today = localDate(new Date(), timezone);
          const range = localDayRange(today, timezone);
          filters.push("julianday(a.starts_at) >= julianday(?) AND julianday(a.starts_at) < julianday(?)");
          bindings.push(range.from, range.to);
          if (user.role === "SPECIALIST") { filters.push("a.employee_id IN (SELECT id FROM employees WHERE user_id = ? AND is_active = 1)"); bindings.push(user.id); }
        }
        const visits = await env.DB.prepare(`SELECT a.id, a.starts_at AS startsAt, a.status, c.full_name AS clientName, b.name AS branchName,
          (SELECT group_concat(s.name, ', ') FROM appointment_services aps JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id) AS serviceName
          FROM appointments a JOIN clients c ON c.id = a.client_id LEFT JOIN branches b ON b.id = a.branch_id WHERE ${filters.join(" AND ")} ORDER BY a.starts_at LIMIT 8`)
          .bind(...bindings).all<{ id: string; startsAt: string; status: string; clientName: string; serviceName: string; branchName: string }>();
        const items = visits.results ?? [];
        text = items.length ? (staff ? "Приёмы сегодня:\n\n" : "Ваши ближайшие визиты:\n\n") + items.map((visit) => [
          new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(visit.startsAt)),
          staff ? visit.clientName : null, visit.serviceName, visit.branchName,
        ].filter(Boolean).join(" · ")).join("\n\n") : staff ? "На сегодня записей нет." : "Ближайших записей пока нет. Подберём удобное время?";
        if (!staff) for (const visit of items.slice(0, 3)) rows.push([
          { text: "Подтвердить · " + new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, timeStyle: "short" }).format(new Date(visit.startsAt)), callback_data: "confirm:" + visit.id },
          { text: "Отменить", callback_data: "cancel:" + visit.id },
        ]);
      }
    } else if (command !== "/start") text = "Помогу записаться и посмотреть визиты. Выберите действие ниже или используйте /help.";
  }
  const eventKey = "telegram-update:" + update.update_id;
  statements.push(env.DB.prepare("INSERT INTO message_outbox(id, event_key, telegram_id, template_key, payload_json) VALUES(?, ?, ?, 'DIRECT', ?)")
    .bind(newId(), eventKey, telegramId, JSON.stringify({ message: text.slice(0, 4096), replyMarkup: rows.length ? { inline_keyboard: rows } : undefined, userId: allowed ? user?.id : undefined, clientId: allowed ? user?.clientId : undefined, requiredPermission })));
  try { await env.DB.batch(statements); }
  catch (error) {
    if (await env.DB.prepare("SELECT update_id FROM telegram_updates WHERE update_id = ?").bind(update.update_id).first()) return json({ ok: true });
    const message = error instanceof Error ? error.message : "";
    // A domain-rule failure (stale revision, overlapping slot, closed visit) is answered to the client and the
    // update is still recorded, otherwise Telegram would redeliver the same callback forever.
    const reply = /mutation_precondition/.test(message) ? "Запись уже изменилась. Откройте свои записи и проверьте актуальный статус."
      : /CRM_SLOT_UNAVAILABLE/.test(message) ? "Это время уже занято у специалиста. Для изменений свяжитесь с администратором."
      : /CRM_VISIT_CLOSED/.test(message) ? "Визит уже завершён и не может быть изменён."
      : null;
    if (!reply) throw error;
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO telegram_updates(update_id) VALUES(?)").bind(update.update_id),
      env.DB.prepare("INSERT OR IGNORE INTO message_outbox(id,event_key,telegram_id,template_key,payload_json) VALUES(?,?,?,'DIRECT',?)")
        .bind(newId(), eventKey, telegramId, JSON.stringify({ message: reply })),
    ]);
  }
  context.waitUntil(processOutbox(env, eventKey).catch(() => console.error(JSON.stringify({ event: "bot_reply_deferred", updateId: update.update_id }))));
  return json({ ok: true });
};
