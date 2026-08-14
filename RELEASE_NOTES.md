# v0.6.0 — Production Hardening & Operations UX

Дата: 2026-08-14

## Исправлено

- устранён риск захвата чужой клиентской карточки через телефонный onboarding;
- добавлено backend-ограничение данных SPECIALIST для поиска, задач, follow-up, отзывов и Notification Center;
- исправлен рабочий workflow записи: нельзя перескочить из запланированной записи сразу в завершённую;
- платежи и возвраты защищены атомарной проверкой остатка, idempotency и audit внутри одной D1 batch-операции;
- ручные складские движения ограничены явными ручными типами, а списания не могут увести остаток ниже нуля при retry;
- частичная приёмка закупки защищена условным изменением количества и связанного StockMovement;
- P&L учитывает возвраты в графике net revenue, периодные платежи в сервисной детализации и выбранные payroll-срезы;
- клиентские уведомления записи переведены в message outbox с дедупликацией, retry и восстановлением зависших сообщений;
- уведомления в интерфейсе получили отметку прочтения и действие «Прочитать всё»;
- модальные окна получили Escape, focus trap, возврат фокуса и доступный aria-labelledby;
- добавлены CSP/HSTS/frame/referrer headers, safe-area и мобильные touch targets.

## Миграция

- migrations/0009_production_hardening.sql добавляет шаблоны событий переноса/отмены и индексы очереди.

## Проверки

- npm run typecheck
- npm run lint
- npm run test
- npm run build:pages

# v0.5.0 — Business OS

Дата: 2026-08-11

## Добавлено

- реальный склад: товары, категории, поставщики, остатки, филиальные локации, движения и low-stock alerts;
- закупки DRAFT/ORDERED/PARTIALLY_RECEIVED/RECEIVED/CANCELLED с частичным получением и движениями прихода;
- автоматическое idempotent списание расходников услуг после COMPLETED и журнал проблем недостатка остатков;
- расчёт себестоимости и contribution margin, P&L с периодами, сравнением и филиальными/сервисными срезами;
- KPI команды, загрузка по доступным рабочим минутам, retention, repeat booking, новые/возвратные клиенты и план/факт;
- follow-up задачи после визита, системные сегменты клиентов и пользовательские сегменты;
- Telegram message outbox, централизованные шаблоны, placeholders, retry и дедупликация campaign/automation сообщений;
- campaigns, internal tasks и Notification Center с low-stock, overdue, unpaid, follow-up и системными событиями;
- сверка payments/refunds/payroll/rent/utilities с financial ledger;
- payroll drill-down до платежей и корректировок без изменения закрытых snapshot-периодов;
- глобальный поиск с `Ctrl/Cmd + K`, новые CSV export-типы и `/api/health`;
- бизнес-дизайн поверхностей и mobile/Telegram polish для новых рабочих разделов;
- migration `0008_business_os.sql`, Prisma models и тесты для новых Decimal-расчётов.

## API и backend

- `/api/inventory`, `/api/inventory/movements`, `/api/inventory/consumables`, `/api/inventory/issues`;
- `/api/purchases`, `/api/purchases/:id/receive`;
- `/api/pnl`, `/api/kpi`, `/api/goals`, `/api/retention`, `/api/follow-ups`;
- `/api/campaigns`, `/api/campaigns/:id/send`, `/api/tasks`, `/api/notifications`;
- `/api/reconciliation`, `/api/search`, `/api/health`;
- scheduled notification Worker обрабатывает outbox и повторные отправки с backoff.

## Ограничения

- runtime production по-прежнему Cloudflare D1; PostgreSQL/Prisma migration подготовлены, но cutover не выполняется без отдельной production-конфигурации;
- Cloudflare Queues/DLQ не включены, поэтому текущий retry работает через cron Worker и таблицу outbox.

## Проверки

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run build:pages`

# v0.4.0 — Operations & Reliability

Дата: 2026-08-11

## Добавлено

- безопасный Telegram bootstrap: неизвестные ID больше не получают staff-роль из allowlist, owner определяется только через `CRM_OWNER_TELEGRAM_ID`;
- строгая ownership-проверка для SPECIALIST при изменении записи;
- `employee_services` с миграционным заполнением текущих активных связей;
- availability и appointment API проверяют, что специалист оказывает выбранные услуги в выбранном филиале;
- отсутствие персонального активного графика больше не создаёт искусственные доступные окна;
- `appointment_slot_reservations` с 15-минутными блоками, покрывающими всю длительность приёма;
- атомарное создание/перенос записи вместе с reservation rows внутри D1 batch;
- `booking_idempotency_keys` и `idempotencyKey` в клиентском booking retry;
- миграция `0007_operations_reliability.sql` без destructive reset.

## Проверки

- локально применены D1 migrations `0001`–`0007`;
- `npm run typecheck`
- `npm run lint`
- `npm run test`

# v0.3.0 — Client Experience & Smart Forms

Дата: 2026-08-11

## Добавлено

- единый Kazakhstan phone source of truth: `normalizePhone`, `formatKzPhone`, `getKzNationalDigits`, `toKzE164`;
- smart `PhoneInput` на onboarding, профиле, клиентах, сотрудниках и филиалах;
- structured field errors и человекочитаемый error map для client API;
- Telegram-prefill имени в onboarding и безопасное восстановление при duplicate phone/linking конфликте;
- профиль-карточка в режиме чтения, отдельное редактирование, reminders и связь с администратором;
- booking recovery: быстрые даты, специалист по желанию, ближайшее окно, waitlist duplicate protection, haptic feedback и success state;
- reschedule с сохранением старой записи до успешного подтверждения нового времени;
- appointment history с группировкой, inline cancellation confirmation, повторной записью и contextual reviews;
- request race protection для availability через `AbortController` и request identity;
- Telegram safe-area CSS variables, BackButton, keyboard cleanup и мобильные touch targets;
- тесты эквивалентных форматов телефонов и обновление версии проекта до `0.3.0`.

## Проверки

- `npm run typecheck`
- `npm run lint`
- `npm run test`

# v0.2.0 — Real CRM Core

Дата: 2026-08-10

## Добавлено

- real database CRUD для клиентов, услуг, сотрудников, филиалов, записей и финансов;
- Telegram authentication с серверной проверкой initData, HttpOnly-сессией и приглашениями по Telegram ID;
- RBAC для OWNER, ADMINISTRATOR, SPECIALIST и ACCOUNTANT;
- many-to-many привязка сотрудников к филиалам;
- рабочие графики, перерывы, отпуска, больничные и блокировки времени;
- appointment engine с snapshot цен, вычислением `endsAt`, строгими статусами и conflict detection;
- частичные платежи, QR/перевод и отдельные refund records;
- единый financial ledger без двойного учёта аренды и коммунальных;
- rent и utilities с due/overdue статусами и расчётом показаний;
- payroll engine с фиксированной частью, процентом от оплаченной выручки, бонусами, удержаниями, авансами и закрытием периода;
- real dashboard и reports из базы без hardcoded финансовых показателей;
- AuditLog для бизнес-критичных действий;
- CSV export клиентов, записей, платежей, расходов и зарплаты;
- рабочие формы настроек, филиалов и приглашения пользователей;
- client detail page, timeline, история визитов и оплат;
- Vitest, TypeScript, ESLint и production build checks;
- Prisma 7 PostgreSQL schema/migration baseline для будущего Cloudflare Hyperdrive/API cutover.

## Важно

Существующий production Pages runtime сохранён на Cloudflare D1, потому что в подключённом Cloudflare account на момент релиза не был настроен PostgreSQL/Hyperdrive и не было безопасного `DATABASE_URL`. Prisma schema и migration подготовлены отдельно, без публикации секретов и без destructive reset.
