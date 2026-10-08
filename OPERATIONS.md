# Публикация и восстановление CRM

Production: Cloudflare Pages `podologymk-crm`, D1 `podologymk_crm`, cron worker `podologymk-notifications`, private service workers `podologymk-automation` / `podologymk-delivery`. Адрес Mini App: https://podologymk-crm.pages.dev. Не подменяйте production project/bindings на staging.

v0.9.1 — PR-кандидат, без разрешения на merge/deploy. На момент аудита 2026-10-09 (Asia/Aqtobe) production остаётся 0.9.0, все migrations 0001–0014 применены. Команды публикации ниже предназначены только для отдельного, явно согласованного выпуска. Новых migrations для v0.9.1 нет.

## Проверка кандидата

Node.js 24; чистая release-ветка, точный commit SHA, авторизация в нужном Cloudflare аккаунте. Не публикуйте неподтверждённые локальные изменения.

```sh
npm ci
npm run db:generate
npm run db:validate
npm run typecheck
npm run lint
npm test
npm audit --omit=dev --audit-level=high
npm audit --audit-level=high
npm run build:pages
npm run qa:api
npx --no-install playwright install chromium
node scripts/serve-export.mjs
```

В другом терминале: `CRM_PREVIEW_ORIGIN=http://127.0.0.1:8788 npm run qa:ui`. Для установленного Chrome: `PLAYWRIGHT_CHANNEL=chrome`; если Playwright установлен вне проекта — `PLAYWRIGHT_MODULE=/absolute/path/to/playwright`. API в UI-тесте подменяются фикстурами, поэтому он не подтверждает авторизацию реального Telegram-пользователя.

## Перед изменением базы

1. Проверьте `wrangler whoami`, существующий Pages project, D1 binding и настроенные имена secrets. Не выгружайте значения токенов в терминал.
2. Сделайте D1 export в уникальный файл внутри игнорируемой `.wrangler/backups/`; права файла 600. Резервная копия содержит персональные данные: не коммитьте её и не публикуйте.
3. Выполните read-only preflight: актуальная цепочка `d1_migrations`, `PRAGMA foreign_key_check`, количества записей/оплат/ledger. Для 0013 запрос ниже должен вернуть пустой список:

```sql
SELECT payment_id, COUNT(*) AS count
FROM financial_transactions
WHERE kind = 'PAYMENT' AND payment_id IS NOT NULL
GROUP BY payment_id HAVING COUNT(*) > 1;
```

Если есть дубли или ошибки внешних ключей — остановитесь. Не удаляйте данные автоматически ради успешной миграции.

Для старых установок до v0.8.0 применяются 0012 и 0013; в актуальном production они уже применены. Миграция 0013 переводит открытые CALCULATED периоды в DRAFT; после обновления пересчитайте их перед закрытием. Закрытые периоды не изменяются.

Для v0.9.0 нужна additive migration 0014. До её применения проверьте отсутствие нескольких активных удержаний одного waitlist_id и конфликтующих интервалов HELD. Не исправляйте такие записи удалением без разбора.

Восстановление export в изоляции: `node scripts/verify-backup.mjs .wrangler/backups/<точный backup>.sql`. Скрипт не пишет в D1: восстанавливает данные в памяти, проверяет FK и воспроизводит отсутствующие индексы/триггеры из сохранённой migration chain. Это не является разрешением на импорт backup в production.

## Staging и настоящий API E2E

Staging Pages `podologymk-crm-staging`, D1 `podologymk_crm_staging` не используют production bot token. `APP_ENV=staging` отключает отправку Telegram и проверки production cron. Fixture содержит только QA-данные.

`npm run qa:api` самостоятельно создаёт новый локальный D1, применяет полную migration chain и synthetic fixture, поднимает Pages на 8790 и automation Worker на 8791. Проверяет конкурентное создание предложений, любой/явный филиал и принятие hold. Не требует Cloudflare API token; все SQL-команды имеют `--local`. Скрипт API E2E запрещает записи на production hostname. Порты должны быть свободны; логи остаются в игнорируемой `.wrangler/api-qa-*/`.

Удалённая проверка: `CRM_STAGING_QA_SETUP=1 node scripts/publish-staging-smoke.mjs` после build и применения staging migrations/fixture. Она ротирует **только staging** synthetic signing key, публикует staging и запускает API E2E. Ротация инвалидирует старые staging initData; секреты не выводятся. Реальный вход внутри Telegram требует отдельного тестового бота — основной бот не переподключается.

## Порядок публикации

1. Backup и preflight.
2. `npx wrangler d1 migrations apply podologymk_crm --remote`.
3. `npx wrangler deploy --config wrangler.automation.jsonc` и `npx wrangler deploy --config wrangler.delivery.jsonc`. Все три worker-конфигурации имеют `workers_dev=false`, `preview_urls=false`; private automation/delivery не должны получать публичные маршруты.
4. Deploy Pages export с `--project-name podologymk-crm --branch main --commit-hash <точный SHA>`, затем `npx wrangler deploy --config wrangler.notifications.jsonc`. Existing Telegram secret сохраняется; cron получает JOBS/DELIVERY service bindings.
5. `/api/health` должен возвращать 200, version 0.9.1, schema 0014. Закрытые API без сессии — 401; чужой Origin — 403; webhook без правильного secret — 403.
6. После следующего cron проверьте `worker_runs.notifications`, `automation` и `telegram-config-0.9.1`, затем `/api/readiness` (200). Временный 503 до первого нового cron ожидаем. Доставка и настройка меню имеют независимые статусы.
7. Подтвердите экраны из живого Mini App; health не заменяет проверку клиентского пути. Адрес/меню ведут на прежний домен, изменения будут видны после повторного открытия Mini App.

Не создавайте тестовые платежи или визиты в production для smoke-проверки.

## Неоднозначный ответ финансовой операции

Повторяйте исходный запрос с тем же idempotencyKey и неизменённым содержимым. Это возвращает сохранённую квитанцию, а не создаёт вторую операцию. В v0.9.0 ключ сохраняется на устройстве; после перезагрузки баннер «Проверка операций» запрашивает квитанцию текущего пользователя. NOT_FOUND не доказывает провал запроса. Повторите **те же** данные, включая дату операции; при изменении формы это новая операция. При очистке storage/смене устройства сначала проверьте журнал. Ключи серверных финансовых квитанций не очищаются cron.

## Если доставка остановилась

- В «Сегодня» проверьте FAILED, попытки и свежесть worker. Не показывайте клиентам содержимое внутренних payload/токенов.
- 403 Telegram обычно требует восстановления доступа ботом/пользователем; 429 соблюдает retry_after; временные ошибки повторяются с backoff до 5 попыток.
- PROCESSING с истёкшей двухминутной арендой восстанавливается следующими запусками; финальная попытка переходит в FAILED вместе с уведомлением/кампанией.
- Ручной «Повторить» возвращает FAILED в очередь, но не обходит отмену визита, архив клиента или отзыв согласия.
- Проверяйте D1/Pages/Worker quota и ошибки провайдера. Cron выполняет до 8 delivery-вызовов по 3 сообщения (не более 24 кандидатов/запуск); общий бюджет automation/delivery — 90 секунд, каждый automation call ограничен 10 секундами, delivery call/чтение — максимум 40 секундами. Настройка меню отдельно занимает до двух Telegram calls по 10 секунд. Проверки аренды останавливают устаревший coordinator. D1/provider задержки, throttle/retries могут уменьшить фактическую доставку. Таймаут вызывающего worker не гарантирует остановку уже начатой remote операции; ограничения базы и outbox guard обязательны. Напоминания приоритетнее кампаний; aging уменьшает риск голодания рассылки. При росте нагрузки отслеживайте очередь и планируйте пропускную способность.
- Telegram sendMessage не имеет ключа идемпотентности CRM: при сбое между ответом Telegram и commit возможна редкая повторная доставка.

## Откат

- Сначала остановите/исправьте опасную публикацию, сохраните диагностику без секретов и определите последний проверенный Pages deployment / worker version.
- Можно вернуть предыдущий Pages deployment и cron worker через Cloudflare, сохранив additive-схему 0014. Не удаляйте новые таблицы/триггеры. Перед откатом v0.9.0 проверьте HELD: старый frontend не умеет принимать предложения, но ограничения продолжают защищать их до истечения срока. Приватные workers без вызывающего binding не запускаются самостоятельно.
- После отката повторите health/auth и worker-проверки. Health старой версии не проверяет 0013, поэтому отдельно убедитесь в цепочке миграций.
- Восстановление всей базы из export — крайняя мера: оно потеряет изменения после backup. Сначала выгрузите текущее состояние, согласуйте окно простоя и точный момент восстановления с владельцем. Не импортируйте dump автоматически.

## Независимое наблюдение

`Production health` запрашивает запуск каждые 5 минут (`2-57/5`, UTC) и допускает workflow_dispatch. Каждый read-only GET `/api/health` и `/api/readiness` ограничен 15 секундами, имеет 3 попытки с backoff 1/2 секунды; оба endpoint проверяются даже при первом сбое. Диагностика выводит только фиксированные поля, не raw response/credentials.

GitHub scheduled workflows **не гарантируют выполнение в точную минуту**: при нагрузке (особенно minute zero) runs могут задерживаться или пропускаться. Workflow должен быть на default branch; public workflow может автоматически отключиться после 60 дней без активности. Успешный workflow_dispatch не доказывает работу schedule. История аудита содержит один настоящий schedule run, а не ноль; точная причина нерегулярности провайдера не установлена.

После согласованного merge проверьте Actions → Production health → event=schedule и создаваемые runs. Settings → Actions → General: Actions enabled; workflow state Active; default branch main. При неактивности выберите Enable workflow. Для надёжного SLA/точной частоты настройте независимый uptime monitor для двух GET endpoint с timeout/retry и alert channel. GitHub notifications зависят от настроек владельца; аварийный Telegram-канал не настроен. Детали и API evidence: [audit](docs/RELIABILITY_AUDIT_0.9.1.md).

Сводка владельцу включается в настройках CRM (`daily_summary_enabled`, час центра); по умолчанию выключена. Финансовая сверка только сообщает расхождения: автоматическая «починка» проводок запрещена.
