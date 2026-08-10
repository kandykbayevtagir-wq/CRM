# podologymk CRM

Облачная CRM-система для podologymk: записи клиентов, сотрудники, начисление зарплаты, финансы, филиалы и сводные отчёты.

## Что сделано

- интерфейс без демо-клиентов, тестовых сумм и фиктивных сотрудников;
- Cloudflare Pages для фронтенда и Functions для API;
- Cloudflare D1 как единый источник данных с миграциями в `migrations/`;
- авторизация через Telegram Mini App с сессионной cookie;
- CRUD для клиентов, записей, сотрудников, филиалов, настроек и расходов;
- журнал изменений финансовых и справочных операций;
- адаптивный интерфейс, пустые состояния, обработка ошибок и мягкие анимации;
- предварительный расчёт зарплаты: фиксированная часть + процент от фактической выручки.

## Запуск

```bash
npm install
npm run typecheck
npm run build:pages
```

Для локальной базы D1:

```bash
npm run db:local
npx wrangler pages dev out
```

Для применения миграций в облачной базе:

```bash
npm run db:migrate
```

## Telegram Mini App и Cloudflare Pages

Деплой нового проекта выполняется командой:

```bash
npm run deploy:pages
```

Секреты хранятся только в Cloudflare Pages и не добавляются в Git:

```bash
npx wrangler pages secret put TELEGRAM_BOT_TOKEN --project-name podologymk-crm
npx wrangler pages secret put CRM_ALLOWED_TELEGRAM_IDS --project-name podologymk-crm
```

После публикации кнопка Telegram настраивается локально:

```bash
TELEGRAM_BOT_TOKEN="токен-бота" MINI_APP_URL="https://podologymk-crm.pages.dev" npm run configure:telegram
```

`CRM_ALLOWED_TELEGRAM_IDS` ограничивает доступ только разрешёнными Telegram ID. Не публикуйте токен бота в исходниках, коммитах и сообщениях.
