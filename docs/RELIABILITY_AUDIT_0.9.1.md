# v0.9.1 — Reliability & Repository Hardening

Audit date: 2026-10-09, Asia/Aqtobe (2026-10-08 UTC). This is a patch PR, not authorization to merge or publish production.

## Verified starting state

- Fetched origin and tags, fast-forwarded local main before changing source. Main and immutable v0.9.0 tag both resolved to `4983b40208a7e45f44beadfa5b559bb607bf59f3`.
- Existing v0.9.0 GitHub release was published, not draft. No open PRs were present at the initial audit; recent main quality runs passed.
- Dedicated branch: `codex/v0.9.1-reliability-patch`. Published history and v0.9.0 tag remain unchanged.
- Repository is PUBLIC. Admin permission is available; one other write collaborator makes an independent review practical.
- Production read-only probes report 0.9.0, schema 0014, health/readiness HTTP 200. All 14 D1 migrations are applied; `PRAGMA foreign_key_check` returns no violations. Cloudflare query metadata confirmed zero rows written.
- Pages, coordinator, private automation and private delivery configurations target the existing runtime. No production deploy or migration was performed.

## Reproduced defects and fixes

| Defect | Fix / regression |
| --- | --- |
| Any-branch waitlist searched only the first active branch. | Evaluate eligible employee/branch/service pairs across every active branch in one bounded query set; deterministic time/branch/employee ordering. |
| A closure in one branch could hide a valid branch if naively broadening the search. | Apply branch-specific closures to the matching pair; global closures still affect all branches. |
| Large employee lists could exceed D1's bind-parameter limit. | Unique employee IDs in a single JSON bind, tested with over 100 qualified employees. |
| Client/resource archival or service-assignment removal after slot search could still commit an offer. | Atomic mutation guard rechecks client/service/branch/employee, relationships, calendar, user opt-in and original appointment eligibility. |
| Booking/reschedule could race archival or payment of the original appointment. | Recheck resources, calendar, unpaid status and cancellation window inside the booking batch; reject without booking/audit side effects. |
| Telegram offers checked only hold ownership/expiry, not current resources/calendar. | Shared eligibility revalidated just before delivery; invalid message cancellation releases the hold and restores queue progress. |
| RUNNING worker could appear ready using a recent previous completion after its lease expired. | RUNNING requires a current lease and recent start; future/invalid timestamps are not healthy. |
| Private service fetch/body reads could hang beyond coordinator lease. | Bounded calls/body reads, overall budget, ownership checks and lease-conditioned automation status writes. Missing automation binding is recorded as failure. |
| A cancelled purchase could be resurrected by concurrent receipt. | Status rechecked inside receipt transaction. |
| A multi-line receipt could partially commit while returning conflict. | All remaining quantities are guarded before any stock write; stale line rolls back all new receipt/audit effects. |

The initial reliability suite reproduced 12 failures before fixes. Two additional purchase race tests separately failed against the pre-fix implementation. Assertions were retained; fixture/type errors found during development were corrected without reducing coverage.

## Waitlist lifecycle and concurrency

Coverage includes two active branches, B-only service/specialist, A unavailable/closed, null and explicit branch, archived branch/specialist/client/service, time off, working schedules, existing appointments, active/expired holds, service/branch relationship removal, deterministic selection, concurrent archival/payment, cancelled/paid original appointment and invalid Telegram suppression.

The existing unique active hold-per-waiter index and full-interval database triggers remain in place. Guard + hold + OFFERED + outbox commit together. Failed competing offer transactions do not create duplicate messages. Real local D1 receives two concurrent automation requests and produces one offer in B; acceptance and replay produce one appointment. No new DDL is required.

## Security regression scope

Reviewed Telegram HMAC/date/duplicate-key validation, hashed sessions, origin/body controls, CLIENT ownership, SPECIALIST linkage and scoping, permission matrix, appointments, payments/refunds, payroll, expenses, inventory, purchases, exports/reports, campaign consent/automation, notification leases, recovery receipts and audit logs.

Existing tests cover cross-client/specialist IDOR, archive revocation, phone-card claiming, permissions/data minimization, CSV formula safety, payment/refund limits/replays, immutable closed payroll, stock constraints, consent revocation, message deduplication and recovery. An additional 18-case matrix rejects anonymous and CLIENT access to sensitive read/write handlers with no audit side effects. This is a focused review, not a penetration-test certification.

Automation has no Telegram token and remains service-binding-only. All worker configs disable workers.dev and preview URLs; this configuration change is not yet deployed. Pages/coordinator retain encrypted secrets, delivery receives the token over the private binding, and diagnostic output does not include request bodies or raw provider errors.

## Monitoring evidence and changes

Default-branch workflow `.github/workflows/production-monitor.yml` is present and Active. Actions are enabled, default workflow token permissions are read-only, event syntax is valid, repository is not archived, and recent commits rule out the 60-day inactivity condition.

GitHub API history at audit time showed **one actual schedule-triggered execution**, run [37828658560](https://github.com/kandykbayevtagir-wq/CRM/actions/runs/37828658560), created 2026-10-08T19:00:25Z, successful. Manual workflow_dispatch successes are not used as evidence of schedule reliability. A regular five-minute cadence was not established; GitHub's internal scheduling reason is not exposed, so an exact provider root cause is not asserted.

Changes: offset `2-57/5` cron, immutable Actions, non-overlapping job group, event/SHA/timestamp summary, read-only GET to both health/readiness, three attempts with 15-second request/body timeouts, 1/2-second backoff, bounded allowlisted diagnostics and nonzero exit on persistent failure. A 200 response or staging-disabled workers cannot masquerade as healthy production readiness. The second endpoint is still checked if the first fails.

GitHub scheduled workflows are **not guaranteed to run at an exact minute**. High load can delay/drop events; scheduled workflows must exist on the default branch, and public workflows may be disabled after 60 days without activity. Candidate schedule changes cannot be verified until an authorized merge. See [GitHub schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Dependencies and CI

Reviewed actual lockfile versions and published advisory ranges, not just package.json:

| Package | Locked version / decision |
| --- | --- |
| Next.js | 16.4.0 retained; newer than the 16.3.8 September security fix. |
| React / React DOM | 19.2.0 retained; no applicable direct-package advisory found. |
| React Server Components | No direct react-server-dom package entries. Next vendors a 19.3.0 canary dated 2026-10-02; static Pages production does not serve a Next RSC/Server Functions runtime. |
| Prisma / adapter / client | 7.9.1 retained; PostgreSQL reference tooling only. |
| pg | 8.23.0 retained; historical advisory ranges do not apply. |
| Wrangler | 4.149.0 pinned; replaces floating tooling / vulnerable 4.148.0 Miniflare tree. |
| Miniflare / workerd | 5.20261006.1-alpha / 1.20261006.1 via locked Wrangler. |
| sharp | 0.35.5, including Miniflare, fixes GHSA-wq5f-xc86-pv6w. |
| Vitest | 4.1.11 retained; patched version for GHSA-82fw-gwwq-j7x9. |
| ESLint / TypeScript | 9.39.5 / 5.9.3 retained. |
| Playwright | 1.64.0 pinned for reproducible browser QA. |

Both production-only and complete dependency audits report **0 known vulnerabilities** at audit time. This is advisory coverage, not proof that unknown flaws do not exist. Sources: [Next security release](https://nextjs.org/blog/september-2026-security-release), [React maintainer advisories](https://github.com/react/react/security/advisories), [sharp maintainer advisory](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w), [Wrangler release](https://github.com/cloudflare/workers-sdk/releases/tag/wrangler%404.149.0), [Vitest advisory](https://github.com/advisories/GHSA-82fw-gwwq-j7x9).

The existing quality gate is preserved and expanded: clean install, production and development audit, Prisma generation/validation, TypeScript, ESLint, unit/integration, Pages build, real Pages/D1/automation and browser UI. All Actions are immutable SHAs with human-readable version comments. Added CodeQL security-extended analysis, high-severity dependency review on PRs and weekly Dependabot npm/Actions updates. No production deployment is part of these workflows.

## Validation

Local validation after a clean npm ci:

| Check | Result |
| --- | --- |
| npm ci | Passed, lockfile installation. |
| npm audit --omit=dev --audit-level=high | Passed; 0 known vulnerabilities. |
| npm audit --audit-level=high | Passed; 0 known vulnerabilities including tooling. |
| npm run db:generate / db:validate | Passed. |
| npm run typecheck / lint | Passed. |
| npm test | 203 passing tests in 14 files; 78 added to the v0.9.0 baseline of 125. |
| npm run build:pages | Passed; static export generated. |
| npm run qa:api | Passed; clean 0001–0014 D1 chain, actual Pages Functions/private automation execution and concurrent offers. |
| npm run qa:ui | Passed; 22 staff pages and client flows at 1440px and 390px, no runtime errors or horizontal overflow. |
| Production compatibility | Read-only: 14 applied migrations, FK check empty, health/readiness 200 with version 0.9.0. |

GitHub check results for the final commit are recorded on the PR; only that final SHA's results should be used for merge decisions.

## GitHub configuration and emergency tradeoff

Automatically applied and verified through API:

- About description exactly as requested and all 13 requested topics.
- Active `production-main` ruleset targeting `refs/heads/main`, no permanent bypass actors, no force pushes or branch deletion.
- Require PR, one approving review, dismiss stale approvals, require approval of the latest push and resolved conversations; strict required `quality` check, provided by GitHub Actions.
- Dependabot vulnerability alerts and automated security fixes enabled.
- Private vulnerability reporting enabled.
- Secret scanning and push protection were already enabled and remain enabled; no secret-scanning alerts were returned at audit time. This is not a full historical secret audit.

The checked-in ruleset is the reproducible policy template. Additional security check enforcement is verified on the PR before handoff. GitHub settings are live independently from unmerged README/workflow/license files.

There is no permanent admin exemption. If the independent reviewer is unavailable, normal merge is blocked. Emergency maintenance should use a reviewed revert/hotfix PR where possible. An administrator can explicitly edit the ruleset in a documented break-glass incident, record the exact reason/commit, run all possible validation, then restore the policy. Cloudflare rollback to an already verified deployment is separate from bypassing GitHub checks. No emergency exception was exercised in this task.

## Exact manual / post-merge checklist

| Setting | Required value / timing |
| --- | --- |
| Settings → Rules → Rulesets → production-main | Target `refs/heads/main`; Active; PR required; 1 approval; stale approvals dismissed; latest push approved; conversations resolved; block deletion/force pushes; bypass list empty. Verify required check names against final PR: `quality`, `codeql`, `dependency-review`. |
| Settings → Actions → General → Require actions to be pinned to a full-length commit SHA | Enable **after** authorized merge of the pinned workflows. Currently false, deliberately not enabled while old main still uses version tags. |
| Settings → Rules → Rulesets → Require code scanning results | After main has a CodeQL baseline, require tool `CodeQL`, security severity `High or higher`, alert threshold `Errors`. Not enabled before the initial baseline, which would prevent the bootstrap PR from merging. |
| Actions → Production health | State Active, workflow on default `main`; inspect actual `event=schedule` history after merge. Use Enable workflow if inactivity disabled it. |
| Owner GitHub notifications | Enable failed Actions notifications to the intended owner/channel; repository code cannot verify personal delivery preferences. |
| Independent uptime monitor | Monitor both production GET endpoints with bounded timeout/retry and a verified alert recipient if a reliable cadence/SLA is required. Not provisioned here. |
| Settings → General → Danger Zone → Change repository visibility | Choose **PRIVATE** if source must not be publicly readable; requires the owner's separate explicit decision. Not changed in this task. |

The CodeQL job ensures analysis succeeds; a successful analysis job alone is not the same as enforcing a high-severity alert threshold. The post-baseline code-scanning rule closes that distinction. See [GitHub ruleset API](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset).

## Presentation, license and remaining risks

README now explains D1 production, architecture, role boundaries, Telegram/service bindings, finances, tests, development, migrations, release/recovery and limitations. Obsolete version-by-version README claims and private database identifiers in operational prose were removed; historical RELEASE_NOTES sections were preserved. Added SECURITY.md, this audit and root LICENSE using the owner's exact All Rights Reserved text. Package remains private=true and uses UNLICENSED.

The license restricts **legal reuse**. PUBLIC visibility still allows public **reading**. The license does not technically make published code confidential; PRIVATE visibility is the access control. Visibility was not changed.

Remaining risks: GitHub best-effort schedules; Cloudflare quotas/provider failures; Telegram at-least-once delivery and messages already in flight; timeout does not necessarily stop a remote invocation; finite throughput/backoff; no separate test bot for live Telegram login; CodeQL severity enforcement requires the initial main baseline; private visibility and independent alerts require owner configuration. Transaction guards cannot guarantee that no failure will ever occur.

No v0.9.1 tag/release, merge, production deployment, bot repointing, secret disclosure or production fixture write was performed.
