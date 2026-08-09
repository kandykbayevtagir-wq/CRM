import { BellRing, Building2, LockKeyhole, SlidersHorizontal, UsersRound } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Button, PageHeader, SectionCard } from "@/components/ui";

export default function SettingsPage() {
  return (
    <AppShell>
      <PageHeader eyebrow="Управление" title="Настройки" description="Настройте филиалы, роли, уведомления и правила расчёта зарплаты." actions={<Button>Сохранить изменения</Button>} />
      <div className="settings-grid">
        <SectionCard title="Профиль центра" subtitle="Основные данные организации"><div className="settings-icon-heading"><span className="settings-big-icon settings-purple"><Building2 size={20} /></span><div><strong>podo center</strong><span>Подологический центр · 2 филиала</span></div></div><div className="settings-list"><div className="settings-item"><div><strong>Название организации</strong><span>Отображается в отчётах и чеках</span></div><span className="settings-value">podo center</span></div><div className="settings-item"><div><strong>Валюта</strong><span>Используется в расчётах</span></div><span className="settings-value">₸ Тенге</span></div><div className="settings-item"><div><strong>Часовой пояс</strong><span>Для календаря и уведомлений</span></div><span className="settings-value">Астана (UTC+5)</span></div></div></SectionCard>
        <SectionCard title="Уведомления" subtitle="Кому и когда отправлять напоминания"><div className="settings-list"><div className="settings-item"><div><strong>Напоминание о записи</strong><span>За 24 часа до приёма</span></div><button className="toggle toggle-on" aria-label="Включено" /></div><div className="settings-item"><div><strong>Новая запись администратору</strong><span>Push и email уведомление</span></div><button className="toggle toggle-on" aria-label="Включено" /></div><div className="settings-item"><div><strong>Просроченные платежи</strong><span>Каждый рабочий день в 10:00</span></div><button className="toggle" aria-label="Выключено" /></div></div></SectionCard>
        <SectionCard title="Роли и доступы" subtitle="Права пользователей CRM"><div className="settings-list"><div className="settings-item"><div><strong>Владелец</strong><span>Полный доступ ко всем разделам</span></div><UsersRound size={18} color="#6f5be7" /></div><div className="settings-item"><div><strong>Администратор</strong><span>Записи, клиенты и оплаты</span></div><SlidersHorizontal size={18} color="#6f5be7" /></div><div className="settings-item"><div><strong>Специалист</strong><span>Свои записи и клиенты</span></div><LockKeyhole size={18} color="#6f5be7" /></div></div></SectionCard>
        <SectionCard title="Правила зарплаты" subtitle="Базовые параметры для новых сотрудников"><div className="settings-list"><div className="settings-item"><div><strong>Модель по умолчанию</strong><span>Фиксированная часть + процент</span></div><span className="settings-value">30%</span></div><div className="settings-item"><div><strong>Закрытие периода</strong><span>После закрытия суммы не пересчитываются</span></div><BellRing size={18} color="#6f5be7" /></div><div className="settings-item"><div><strong>Журнал изменений</strong><span>Для всех финансовых операций</span></div><span className="status-pill status-active">Включён</span></div></div></SectionCard>
      </div>
    </AppShell>
  );
}
