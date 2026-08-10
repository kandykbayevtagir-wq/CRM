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
- отдельный клиентский Mini App: профиль, онлайн-запись, перенос, отмена и лист ожидания;
- каталог услуг с ценой и длительностью, рабочие часы специалистов и периоды отсутствия;
- бонусная программа с историей начислений после завершённого визита;
- отзывы клиентов с внутренней модерацией;
- подтверждения записи и автоматические напоминания за 24 часа и за 2 часа;
- check-in по одноразовому коду и сканирование QR внутри Telegram;
- Telegram-команды `/start`, `/book`, `/appointments`, `/my_appointments` и deep links в Mini App.

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
npx wrangler pages secret put TELEGRAM_WEBHOOK_SECRET --project-name podologymk-crm
```

Планировщик напоминаний — отдельный Cloudflare Worker с D1-доступом:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN --config wrangler.notifications.jsonc
npm run deploy:notifications
```

После публикации кнопка Telegram настраивается локально:

```bash
TELEGRAM_BOT_TOKEN="токен-бота" MINI_APP_URL="https://podologymk-crm.pages.dev" npm run configure:telegram
```

`CRM_ALLOWED_TELEGRAM_IDS` ограничивает доступ только разрешёнными Telegram ID. Не публикуйте токен бота в исходниках, коммитах и сообщениях.
