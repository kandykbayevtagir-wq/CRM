-- Templates used by the reliable outbox path for client booking events.
INSERT OR IGNORE INTO notification_templates (id, template_key, name, body) VALUES
  ('template-booking-changed', 'BOOKING_CHANGED', 'Перенос записи', '🔄 {clientName}, ваша запись перенесена на {date} в {time}. Специалист: {specialist}. Услуга: {service}. Филиал: {branch}.'),
  ('template-booking-cancelled', 'BOOKING_CANCELLED', 'Отмена записи', '❌ Запись {date} в {time} отменена. {message}');

CREATE INDEX IF NOT EXISTS idx_notifications_due ON notifications(status, scheduled_at, kind);
CREATE INDEX IF NOT EXISTS idx_message_outbox_processing ON message_outbox(status, updated_at);
