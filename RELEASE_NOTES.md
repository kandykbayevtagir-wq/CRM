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
