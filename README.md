# podologymk CRM

`v0.5.0 — Business OS` — Inventory, Intelligence, Retention & UX для Telegram Mini App и веб-CRM подологического центра podologymk.

Система покрывает полный рабочий поток: клиент → запись → специалист и филиал → проведение приёма → фактическая оплата → ledger → зарплата → расходы → прибыль и отчёты.

## Архитектура

- Next.js 16 + React 19 + TypeScript — статически экспортируемый интерфейс Mini App.
- Cloudflare Pages — фронтенд и Pages Functions API.
- Cloudflare D1 — текущий production runtime и облачный источник данных существующего проекта.
- Prisma 7 + PostgreSQL — каноническая расширенная схема и безопасная migration baseline в `prisma/`; runtime cutover на PostgreSQL/Hyperdrive выполняется после предоставления production `DATABASE_URL` или Hyperdrive binding.
- Telegram Mini App initData проверяется на сервере, после чего создаётся HttpOnly-сессия с хешированным токеном.
- `src/lib/` содержит переиспользуемые правила телефона, permissions, переходов статусов, payroll, ledger и Decimal-расчётов; страницы не являются источником финансовой истины.

Текущий D1 runtime сохранён специально: он уже подключён к живому Cloudflare Pages проекту и не требует выдуманных PostgreSQL credentials. Prisma-схема не подменяет production D1 автоматически и не отправляет секреты в браузер.

## Основные возможности v0.2.0

- реальный CRUD клиентов с нормализацией телефона, защитой дублей, архивом, пагинацией и карточкой `/clients/[id]`;
- каталог услуг с ценой, себестоимостью, длительностью и snapshot цены в записи;
- сотрудники, зарплатные настройки и связь с несколькими филиалами через `employee_branches`;
- рабочие графики, перерывы, time-off и блокировка времени;
- календарь день/неделя, фильтры филиала, специалиста, статуса и даты;
- строгие переходы `SCHEDULED → CONFIRMED → ARRIVED → IN_PROGRESS → COMPLETED`, отмена и no-show;
- серверная проверка конфликтов пересекающихся записей;
- платежи `CASH`, `CARD`, `TRANSFER`, `QR`, `OTHER`, частичная оплата и отдельные возвраты;
- единый финансовый ledger для оплат, возвратов, расходов, аренды, коммунальных и зарплат;
- аренда со сроком и статусами `PLANNED/DUE/PAID/OVERDUE`;
- коммунальные услуги с показаниями и формулой `(current - previous) × tariff + fixedFee`;
- payroll engine: фикс + процент от оплаченной части завершённых приёмов + бонусы − удержания − авансы ± ручные корректировки;
- пересчёт открытого периода и immutable snapshot после закрытия периода;
- реальные dashboard/reports агрегаты, средний чек, margin, загрузка по рабочему времени, выручка по специалистам и услугам;
- RBAC для `OWNER`, `ADMINISTRATOR`, `SPECIALIST`, `ACCOUNTANT` и `CLIENT`: новый Telegram пользователь автоматически получает только клиентский кабинет, а staff-доступ выдаётся отдельно;
- AuditLog для критичных изменений и уведомительная архитектура Cloudflare Worker;
- CSV-экспорт клиентов, записей, платежей, операций и зарплаты;
- бонусы, отзывы, клиентский кабинет, лист ожидания, check-in и Telegram-напоминания из предыдущего этапа.

## Клиентский опыт v0.3.0

- единая нормализация телефонов Казахстана в формате `77001234567` и reusable `PhoneInput` с форматированием, autofill/paste и корректным поведением клавиатуры;
- onboarding с Telegram-prefill имени, обязательными только именем и телефоном, структурированными ошибками рядом с полями и безопасным linking по телефону;
- читаемый профиль с отдельным режимом редактирования, настройкой напоминаний и рабочей кнопкой связи через Telegram;
- умный booking flow с быстрыми датами, выбором любого/конкретного специалиста, ближайшим доступным окном, waitlist-дубликатами и восстановлением после конфликта;
- история записей по группам «Предстоящие / Прошедшие / Отменённые», перенос, подтверждение отмены, повторная запись и отзывы после завершённого визита;
- Telegram BackButton, safe-area переменные, мягкие haptics, скрытие клавиатуры после действий и защита от устаревших ответов при быстром переключении дат;
- клиентские ошибки преобразуются в понятные сообщения, а интерактивные состояния имеют loading, empty, error и success варианты.

## Надёжность v0.4.0

- неизвестный Telegram ID всегда получает роль `CLIENT`; первоначальный `OWNER` создаётся только для `CRM_OWNER_TELEGRAM_ID`;
- `CRM_ALLOWED_TELEGRAM_IDS` разрешает вход уже созданным staff-пользователям, но больше не выдаёт роль новому пользователю;
- специалист не может изменить свою запись и назначить её другому сотруднику;
- `employee_services` ограничивает доступные услуги конкретного специалиста и филиала;
- availability использует только активный персональный график специалиста — отсутствие графика означает отсутствие окон;
- 15-минутные reservation-блоки и D1 uniqueness защищают от параллельного бронирования пересекающихся услуг;
- client booking поддерживает `idempotencyKey`, поэтому сетевой retry возвращает уже созданную запись;
- новая migration `0007_operations_reliability.sql` добавляет service matrix, slot reservations и idempotency storage.

## Business OS v0.5.0

- склад с товарами, категориями, поставщиками, филиальными остатками, движениями и low-stock предупреждениями;
- закупки с частичным получением, историей прихода и idempotent списанием в склад;
- расходники услуг: при завершении приёма материалы списываются один раз и связываются с записью;
- P&L с gross/net revenue, возвратами, себестоимостью, комиссиями, зарплатой, арендой, коммунальными и operating profit;
- KPI специалистов, contribution margin, загрузка рабочего времени, retention и план/факт с прогнозом текущего темпа;
- автоматические CRM-сегменты, follow-up после визита, кампании Telegram и outbox с retry/дедупликацией сообщений;
- внутренние задачи, Notification Center, сверка payments/refunds/payroll/rent/utilities с ledger;
- drill-down зарплаты до оплаченных приёмов и корректировок при сохранении immutable закрытого периода;
- глобальный поиск `Ctrl/Cmd + K`, CSV-экспорт склада, движений, закупок, задач, KPI и P&L;
- единый glass-поверхностный UI, адаптивные операционные экраны, loading/empty/error/success состояния и production health endpoint;
- новая D1 migration `0008_business_os.sql`; Prisma schema синхронизирована с добавленными сущностями.

## Локальный запуск

```bash
npm install
npm run typecheck
npm run test
npm run lint
npm run build:pages
```

Для локального D1:

```bash
npm run db:local
npx wrangler pages dev out
```

Локальные Pages Functions доступны через тот же origin. В development можно использовать локальную сессию только для smoke-тестов; production доступ всегда идёт через Telegram auth и серверную сессию.

## PostgreSQL / Prisma

Каноническая схема находится в [prisma/schema.prisma](prisma/schema.prisma), baseline migration — в `prisma/migrations/0001_real_crm_core/`.

Не запускайте Prisma migration без настоящего PostgreSQL:

```bash
export DATABASE_URL="postgresql://user:password@host:5432/database?sslmode=require"
npm run db:validate
npm run db:generate
npx prisma migrate deploy
npm run db:seed
```

`DATABASE_URL` используется только серверными Prisma-командами и никогда не попадает в frontend bundle. Для Cloudflare Pages direct PostgreSQL connection не встраивается в браузер: нужен Hyperdrive binding либо отдельный Worker/API runtime с секретным подключением.

## Cloudflare Pages / D1

Production project: `podologymk-crm`.

```bash
npm run db:migrate
npm run deploy:pages
```

D1 migration files находятся в `migrations/`. Prisma migration и D1 migration — разные targets; Prisma SQL нельзя применять к D1.

Секреты задаются только через Cloudflare:

```bash
npx wrangler pages secret put TELEGRAM_BOT_TOKEN --project-name podologymk-crm
npx wrangler pages secret put CRM_ALLOWED_TELEGRAM_IDS --project-name podologymk-crm
npx wrangler pages secret put CRM_OWNER_TELEGRAM_ID --project-name podologymk-crm
npx wrangler pages secret put TELEGRAM_WEBHOOK_SECRET --project-name podologymk-crm
```

Планировщик напоминаний:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN --config wrangler.notifications.jsonc
npm run deploy:notifications
```

После деплоя Telegram Mini App кнопка настраивается только локальной командой с секретом:

```bash
TELEGRAM_BOT_TOKEN="..." MINI_APP_URL="https://podologymk-crm.pages.dev" npm run configure:telegram
```

`CRM_ALLOWED_TELEGRAM_IDS` ограничивает staff-доступ. Новый Telegram ID создаётся автоматически только с ролью `CLIENT`: он не видит сотрудников, финансы, настройки и другие CRM-разделы. Сотрудникам роль и доступ выдаются отдельно через настройки или allowlist.

## Environment variables

Список без секретных значений находится в [.env.example](.env.example).

- `DATABASE_URL` — только для Prisma/PostgreSQL migration и seed;
- `SEED_OWNER_TELEGRAM_ID` — development seed;
- `TELEGRAM_BOT_TOKEN` — Cloudflare encrypted secret;
- `CRM_ALLOWED_TELEGRAM_IDS` — Cloudflare encrypted secret, CSV Telegram ID сотрудников;
- `CRM_OWNER_TELEGRAM_ID` — единственный Telegram ID, которому разрешён первоначальный owner bootstrap;
- `TELEGRAM_WEBHOOK_SECRET` — Cloudflare encrypted secret.

## Tests and checks

```bash
npm run test        # Vitest: payroll, permissions, overlap, payments, ledger, duplicate phone
npm run typecheck   # TypeScript + Prisma client generation
npm run lint        # ESLint
npm run build:pages # production static export
```

Критические write endpoints повторно валидируют входные данные и permissions на backend, используют D1 batch transactions, а финансовые суммы в shared payroll/ledger rules считаются через `Decimal`.

## Release notes

Подробный список изменений: [RELEASE_NOTES.md](RELEASE_NOTES.md).

## Known technical debt

1. Production сейчас остаётся на существующем Cloudflare D1, чтобы не ломать работающий Pages deploy. Для полноценного PostgreSQL runtime нужен production `DATABASE_URL`/Hyperdrive и отдельный cutover с миграцией данных из D1.
2. Уведомления пока используют существующий scheduled Worker без полноценной Queue/DLQ outbox-цепочки; это следующий reliability этап.
3. Cloudflare Queue/DLQ bindings не добавлены в текущий deploy: outbox уже работает через scheduled Worker, а Queue можно подключить без изменения доменной модели.
4. Production runtime сохраняется на D1; Prisma/PostgreSQL остаётся канонической схемой для будущего controlled cutover через Hyperdrive/API.
5. Массовые кампании ограничены Telegram и требуют настроенного `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` и cron Worker.
