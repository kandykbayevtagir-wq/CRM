# podologymk CRM

Production-grade CRM and Telegram Mini App for appointment operations, client management, finance, payroll, inventory, automation and business reporting. Built with Next.js, TypeScript, Cloudflare Pages, Workers and D1.

Release candidate: **v0.9.1 — Reliability & Repository Hardening**. This patch improves reliability and repository controls; it is not a large feature release. See [release notes](RELEASE_NOTES.md), [operations](OPERATIONS.md) and the [release audit](docs/RELIABILITY_AUDIT_0.9.1.md).

## Overview

The CRM supports a multi-branch appointment business with separate staff and client experiences. Telegram provides the entry point and verified identity; all access decisions and business mutations run on the backend. This repository is proprietary software, not an open-source distribution.

## Core capabilities

- Branches, services, specialist assignments, working schedules, breaks, absences and closures.
- Client profiles, booking, rescheduling, cancellation, check-in, reviews, loyalty and waitlists.
- Payments, refunds, expenses, rent, utilities, immutable closed payroll, stock and purchases.
- Operational dashboards, financial reconciliation, reports, role-scoped CSV exports and recovery receipts.
- Telegram outbox, reminders, consent-based campaigns, follow-ups, tasks and optional owner summaries.

## Architecture

The Next.js App Router application builds a **static export** in `out/`. Cloudflare Pages serves it and routes `/api/*` to Pages Functions. Functions and private Workers use Cloudflare D1 directly; there is no Next.js production Node server.

Key source locations:

- `src/app/`, `src/components/`: staff/client UI and shared components.
- `functions/api/`, `functions/_lib/`: API, authorization and D1 business logic.
- `workers/`: cron coordinator, private automation and private delivery.
- `migrations/`: ordered, append-only production D1 migrations.
- `tests/`, `scripts/`: regression tests, real-runtime QA and operational tooling.
- `prisma/`: PostgreSQL preparation/reference schema, **not the production database**.

## Security model

Telegram initData is verified server-side using HMAC, bounded auth dates and duplicate-key rejection. Sessions use random tokens stored as hashes and HttpOnly/Secure cookies. API middleware enforces sessions, origin rules, staff allowlists, request size/type limits and endpoint permissions.

CLIENT access is tied to the authenticated client card. A phone number alone cannot claim another card. SPECIALIST queries and mutations are scoped to the linked active employee. Sensitive reports, exports, finance, payroll, settings and audit logs require explicit permissions. Parameterized SQL, transaction guards, revisions and database constraints protect mutations. See [SECURITY.md](SECURITY.md) for responsible reporting.

## Roles and permissions

| Role | Scope |
| --- | --- |
| OWNER | Business administration, financial controls and access management. |
| ADMINISTRATOR | Appointment/client operations, payment collection, stock, purchases and communication; not payroll or unrestricted finance. |
| SPECIALIST | Own appointments and associated clients, reviews, tasks and follow-ups; no client financial/internal CRM details. |
| ACCOUNTANT | Financial reporting, expenses, payroll, inventory and purchases; no unrestricted appointment administration. |
| CLIENT | Own profile, appointments, availability, waitlist, reviews, calendar and loyalty. |

The authoritative matrix is [permissions](src/lib/permissions/index.ts). Hiding a navigation item does not authorize an API request.

## Telegram integration

The primary bot is `@podologymkbot`. Mini App entry points, commands and callbacks use verified identities; webhook requests require the configured secret. Update deduplication and message event keys limit duplicate processing. The primary bot must not be repointed to QA.

Bot secrets remain in encrypted Cloudflare configuration. The automation Worker never receives the bot token. Delivery receives it only through a private service binding, not a public endpoint.

## Automation

The notification coordinator runs every minute, claims a two-minute lease, enqueues reminders, calls private automation, drains bounded delivery batches and separately configures the bot menu. Automation prepares campaigns in resumable pages and scans waitlists incrementally.

An unspecified waitlist branch means all eligible active branches. Service assignments, employee/branch relationships, schedules, absences, closures, appointments and active holds are evaluated together. Selection is ordered by start time, branch ID and employee ID. Offers reserve the full interval for ten minutes; creation and acceptance recheck resources atomically. Invalid/expired offers are released, and stale Telegram offers are suppressed before delivery.

## Financial integrity

Payments, refunds and recoverable financial writes use actor-scoped idempotency receipts. Reusing a key with different input is rejected. Appointment, stock, notification and audit side effects commit together where required. Closed payroll is immutable, stock cannot become negative, and reconciliation checks individual ledger references and amounts. Discrepancies are reported, never automatically repaired.

## Testing and QA

Node.js 24 is the tested baseline. Install from the lockfile, not floating global tools:

```sh
npm ci
npm audit --omit=dev --audit-level=high
npm audit --audit-level=high
npm run db:generate
npm run db:validate
npm run typecheck
npm run lint
npm test
npm run build:pages
npm run qa:api
npx --no-install playwright install chromium
```

For browser QA, run `node scripts/serve-export.mjs`, then `npm run qa:ui` in another terminal. CI installs Chromium system dependencies as well.

Unit/integration tests replay the complete D1 migration chain. `qa:api` creates a fresh **local** D1, starts real Pages Functions and an automation Worker, then tests signed synthetic Telegram auth, permissions, recovery, concurrent booking and concurrent multi-branch offers. UI QA uses mocked API responses on desktop/mobile and does not prove live Telegram authentication.

## Deployment architecture

Production uses Pages `podologymk-crm`, D1 `podologymk_crm`, the `podologymk-notifications` coordinator and private `podologymk-automation` / `podologymk-delivery` service Workers. Separate staging Pages/D1 use synthetic identities and suppress Telegram delivery.

Configuration lives in the relevant `wrangler*.jsonc` files. Do not substitute staging bindings into production or deploy private Workers with public routes.

## Current production runtime

Production URL: [podologymk-crm.pages.dev](https://podologymk-crm.pages.dev). Active database: **Cloudflare D1**, schema chain through `0014`.

Audit snapshot on 2026-10-09 (Asia/Aqtobe): production still reported **0.9.0**. v0.9.1 is a PR candidate and is not deployed by this task. Prisma/PostgreSQL is only preparation/reference tooling; its migrations must never be applied to D1.

## Local development

Use `npm ci` and `npm run dev` for frontend work. Build before running `qa:api` or the export preview. Real local API QA is isolated automatically and never writes to the production hostname.

For manual Pages/D1 development, use a local/staging configuration and `--local` migration commands. Configure synthetic secrets privately in `.dev.vars`; do not use production credentials as fixtures. There is no production authentication bypass.

## Environment variables

[.env.example](.env.example) contains non-production examples. Never place bot tokens or database credentials in `NEXT_PUBLIC_*` variables.

| Name / binding | Purpose |
| --- | --- |
| DB | D1 binding for Pages and Workers. |
| TELEGRAM_BOT_TOKEN | Encrypted Pages/coordinator secret; never configured on automation. |
| TELEGRAM_WEBHOOK_SECRET | Encrypted Pages webhook validation secret. |
| CRM_OWNER_TELEGRAM_ID | Encrypted initial owner bootstrap identity. |
| CRM_ALLOWED_TELEGRAM_IDS | Encrypted staff identity allowlist. |
| MINI_APP_URL | Mini App public origin, separate per environment. |
| JOBS / DELIVERY | Private coordinator service bindings. |
| APP_ENV | `staging` disables Telegram delivery and production cron readiness requirements. |
| DATABASE_URL / SEED_OWNER_TELEGRAM_ID | Optional local PostgreSQL/Prisma reference tooling only. |

## Database migrations

D1 migration files are immutable once published. Apply them in order and validate foreign keys and business constraints before publication. v0.9.1 requires **no new migration**; it remains compatible with schema `0014`.

Always back up before production database changes, keep exports private and validate restores in isolation. See [OPERATIONS.md](OPERATIONS.md). PostgreSQL migrations in `prisma/migrations/` are a different target.

## Release process

1. Fetch latest GitHub main and record its SHA and the current published tag.
2. Work on a dedicated branch, add regression tests and run the full validation pipeline.
3. Open a PR; require current quality/security checks and an independent review.
4. Merge and publish only after explicit owner authorization.
5. Record the exact deployment commit, read-only health/readiness and worker evidence; create a new tag without rewriting old tags.

Repository settings and the emergency maintenance tradeoff are documented in the [hardening audit](docs/RELIABILITY_AUDIT_0.9.1.md).

## Operational recovery

After an ambiguous financial response, retry the **same** operation with the same key and unchanged input. `/api/mutation-status` exposes only the current actor's authorized receipts; NOT_FOUND is not proof that the original request failed.

Expired worker/outbox leases recover on later invocations. Telegram failures use bounded retries and backoff. A rollback preserves additive migrations and must not restore an old database automatically. Follow [OPERATIONS.md](OPERATIONS.md) for backup, recovery and deployment checks.

## Known limitations

- GitHub scheduled workflows are best-effort: they may be delayed or dropped and are not guaranteed to execute at an exact minute. A reliable uptime cadence needs an independent monitor.
- Telegram sendMessage is at-least-once: a crash after acceptance but before the database commit can cause duplicate delivery. A message already in flight cannot be recalled by a later archival; acceptance still revalidates resources.
- Worker call timeouts do not guarantee remote computation has stopped. Transaction guards, holds and unique event keys protect overlapping invocations.
- Free-plan D1/Worker budgets and queue throughput require monitoring as load grows.
- Live Telegram client login is not automated without a separate test bot.
- A proprietary license restricts legal reuse; it does **not** make publicly visible source confidential. The repository remains public. Change visibility to **PRIVATE** if public access must be prevented.

## License

Copyright © 2026 Tagir Kandykbayev. All Rights Reserved.

This is proprietary software. No permission is granted to copy, modify,
redistribute, sublicense, publish, sell, host, or reuse the source code
without prior written authorization from the copyright holder.

See [LICENSE](LICENSE) for the complete terms.
