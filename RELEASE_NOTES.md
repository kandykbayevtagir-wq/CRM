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
