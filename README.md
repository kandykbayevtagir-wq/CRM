# PodoCenter CRM

CRM для патологического/подологического центра: записи клиентов, сотрудники, зарплата, филиалы, аренда, коммунальные услуги и сводный финансовый учёт.

## Что уже есть

- рабочий каркас Next.js 16 + TypeScript;
- первый интерфейс CRM: дашборд, календарь записей, клиенты, сотрудники, финансы, отчёты и настройки;
- Prisma-схема PostgreSQL с филиалами, клиентами, услугами, записями, платежами, зарплатными периодами, корректировками, расходами, арендой, коммунальными платежами и журналом изменений;
- адаптивная боковая навигация и единый визуальный стиль;
- `.env.example` с примером подключения к PostgreSQL.
- Telegram Mini App-обвязка: Telegram WebApp SDK, проверка `initData` в Cloudflare Pages Function и конфигурационный скрипт меню бота;
- Cloudflare Pages-конфигурация через `wrangler.toml`.

## Запуск

```bash
npm install
cp .env.example .env
npx prisma generate
npx prisma migrate dev --name init
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000).

## Telegram Mini App и Cloudflare Pages

Сборка для Pages создаётся командой:

```bash
npm run deploy:pages
```

Секрет бота хранится только в Cloudflare Pages:

```bash
npx wrangler pages secret put TELEGRAM_BOT_TOKEN --project-name podocenter-crm
```

После деплоя настройте кнопку меню бота локально, не добавляя токен в Git:

```bash
TELEGRAM_BOT_TOKEN="новый-токен" MINI_APP_URL="https://podocenter-crm.pages.dev" npm run configure:telegram
```

## Следующий этап

1. Подключить авторизацию и роли доступа.
2. Подключить PostgreSQL к страницам и заменить демонстрационные данные на CRUD.
3. Добавить расчёт зарплаты с фиксацией закрытого периода и журналом корректировок.
4. Добавить импорт/экспорт и уведомления администратора.
