# kpost-testbench_v2

The KPost test bench automation framework, built on [Playwright](https://playwright.dev) and TypeScript. It contains:

- **A centralized API validation framework.** You define an endpoint once, and 44 common validators (auth, authz, status, request, response, schema, headers, errors, performance, security, data conventions) apply automatically. See **[docs/guides/validation-framework.md](docs/guides/validation-framework.md)**.
- **UI end-to-end tests** built on the Page Object Model, running on Chromium, Firefox and WebKit.
- **Automatic Bugzilla filing, routed to the right developer.** Real failures become tickets — deduplicated, validity-gated, never re-filed once a human closes them, and assigned to the module's maintainer (KMail → Jitendra, KPost API and Admin → Jagan, KPost UI → Ayyappan). Dry run by default. See **[docs/guides/bug-filing.md](docs/guides/bug-filing.md)**.

- **Contracts come from the Excel workbook**, not from swagger. One script converts it into separate KPost and KMail contracts plus generated OpenAPI, excluding anything invalid or duplicated. See **[docs/guides/api-contracts.md](docs/guides/api-contracts.md)**.

## Modules

KPost is one product built from separately maintained modules. Each suite targets its own host and owns where its defects go — declared once in [src/config/ownership.config.ts](src/config/ownership.config.ts):

| Suite       | Module                | Base URL             | Bugzilla product | Owner             |
| ----------- | --------------------- | -------------------- | ---------------- | ----------------- |
| `kpost-api` | KPost core API        | `KPOST_API_BASE_URL` | KPost API        | Jaganathan Murthy |
| `admin-api` | Admin module          | `ADMIN_API_BASE_URL` | KPost Admin      | Jaganathan Murthy |
| `kmail-api` | KMail module          | `KMAIL_API_BASE_URL` | KMail API        | Jitendra Kumar    |
| `kpost-ui`  | KPost React front end | `BASE_URL`           | KPost UI         | Ayyappan Ashok    |
| `admin-ui`  | Admin/HR-Setup SPA    | `ADMIN_UI_BASE_URL`  | KPost Admin UI   | Ayyappan Ashok    |

## Stack

- **@playwright/test**: runner, browsers, API requests
- **TypeScript** (strict) with path aliases
- **zod + Ajv (JSON Schema 2020-12)**: contracts, response validation, negative-case generation
- **dotenv**: per-environment configuration, validated at startup
- **ESLint** (typescript-eslint + eslint-plugin-playwright) and **Prettier**
- **GitHub Actions**: the quality gate (typecheck, lint, format) on every push and PR. Test runs stay on the QA machine, where the credentials and the shared-server safety rules live.

## Project structure

```
.
├── playwright.config.ts          # Projects, reporters, prod safety
├── contracts/                    # GENERATED from the workbook: per-suite contract JSON + gap reports
├── openapi/                      # GENERATED OpenAPI (KPost, KMail, Admin) the engine validates against
├── scripts/                      # Node tooling: contract generation, account provisioning, Bugzilla checks
├── docs/                         # Index in docs/README.md
│   ├── guides/                   # How to run it: commands, runbook, bug filing, validation framework, contracts
│   ├── reference/                # What the bench is: bench reference, business rules, FRD map, decision log
│   ├── modules/                  # Per-module analyses: Katchup, Kall, KMail (+ schema), Admin
│   ├── ui/                       # Front-end maps the e2e specs are built from
│   ├── scope/                    # Why an endpoint is blocked or unused (hand-written, evidence-based)
│   ├── generated/                # Ledgers written by `npm run framework` — never hand-edit
│   ├── audits/                   # Dated, point-in-time audits
│   ├── api-specs/                # The product owner's API workbooks and PDF — the source of every contract
│   └── archive/                  # Superseded plans, kept only because other comments cite them
├── src/
│   ├── config/                   # env, api, auth, database and threshold configuration
│   ├── api/
│   │   ├── client/               # api-client, request-builder, response-wrapper, token-provider
│   │   ├── contract/             # workbook-contract: schemas/examples looked up from the generated OpenAPI
│   │   ├── registry/             # api-registry, endpoint-definition
│   │   ├── schema/               # contract-schema (zod / JSON Schema → Ajv)
│   │   ├── schemas/              # kpost-types — the shared KPost field types
│   │   └── definitions/          # ENDPOINT DEFINITIONS, one folder per module (kpost/*, kmail, admin)
│   ├── validation-engine/        # engine, registry, context, result, policy, probe, prod guard
│   ├── validators/               # CENTRAL VALIDATORS (authentication, authorization, request,
│   │                             #   response, security, performance, common) + index.ts registry
│   ├── business-rules/           # Business-rule registry (KPost's rules are asserted in module feature specs)
│   ├── database/                 # MySQL client, per-suite pool, repositories, named DB validations
│   ├── bug-tracker/              # Candidate → validity gate → dedupe → Bugzilla filer/client
│   ├── reporting/                # Report formatter, attachment, Playwright validation reporter
│   ├── fixtures/                 # Custom `test` (engine, endpoints, databases, pages, logger)
│   ├── pages/                    # UI page objects
│   ├── ui/                       # UI health, crawler, screens and breakage-sweep helpers
│   └── utils/                    # Structured logger, masking, correlation IDs, JSON helpers
└── tests/
    ├── api/                      # One thin spec per module area (endpoints come from the registry)
    ├── framework/                # Self-tests proving the framework's guarantees (+ `_*.local` manual probes)
    ├── e2e/                      # KPost UI specs
    ├── e2e-admin/                # Admin/HR-Setup UI specs (a separate SPA)
    └── setup/                    # UI auth setup
```

## Getting started

Requires Node.js 22.18 or newer (24 recommended, see `.nvmrc`).

```bash
npm ci
npx playwright install --with-deps
cp .env.example .env        # then fill in the hosts and the qatest accounts (see the comments inside)
npm run framework           # the bench's own self-tests: no host or credentials needed
npm run kpost               # the KPost API sweep against the live application, files nothing
```

The bench has one target: the live KPost application, driven from the QA machine. Every host and
account is read from `.env` (`TEST_ENV=production` arms the live-safety controls — do not change
it to make something run). There is no bundled mock; `npm run framework` is the only command that
runs without an environment.

## Running tests

**Every command is in one place — [`docs/guides/commands.md`](docs/guides/commands.md).** One command per Bugzilla
product, each with a `:file` variant that also files bugs. The essentials:

| Command                                                           | What it does                                                                             |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm run product:kpost-api` / `product:kpost-api:file`            | KPost API — FULL profile, write-fuzz, lifecycle flows on the test DB (run / run + file). |
| `npm run product:kmail-api` / `product:kmail-api:file`            | KMail API — same tier.                                                                   |
| `npm run product:kpost-admin` / `product:kpost-admin:file`        | Admin API — the owner's PDF endpoints, same tier (Admin DB stays read-only).             |
| `npm run product:kpost-ui` / `product:kpost-ui:file`              | KPost UI on Chromium, Firefox and WebKit.                                                |
| `npm run product:kpost-admin-ui` / `product:kpost-admin-ui:file`  | The Admin/HR-Setup UI (a separate SPA).                                                  |
| `npm run product:all` / `product:all:file`                        | All five, in order.                                                                      |
| `npm run ui:chromium:file` · `ui:firefox:file` · `ui:webkit:file` | KPost UI, one browser per run.                                                           |
| `npm run kpost:full:verify`                                       | Re-check every open KPost API bug; file nothing new.                                     |
| `npm run framework`                                               | The bench's own self-tests.                                                              |
| `npm run check`                                                   | Typecheck + lint + format check (CI gate).                                               |

KDoc/KOS is paused and excluded from every command until the owner says it's ready.

Every run writes a single report — `reports/REPORT.md` (human: execution health + bugs) and
`reports/REPORT.json` (structured). See `docs/guides/commands.md` for the full list and the safety notes.

## Environments

Configuration is resolved in this order (first wins): real environment variables, then `.env.<TEST_ENV>`, then `.env`. Supported environments are `local`, `dev`, `qa`, `staging` and `production`. Every variable is validated in [src/config/env.ts](src/config/env.ts), so bad configuration stops the run immediately. See [.env.example](.env.example).

**Production safety:** with `TEST_ENV=production`, data-mutating endpoints (POST/PUT/PATCH/DELETE, and `@destructive` tests) are blocked unless `ALLOW_DESTRUCTIVE_TESTS=true`. The engine enforces this for every request it sends, including setup calls and probes.

## Writing tests

- **New API endpoint:** add an `EndpointDefinition` in `src/api/definitions/`. No test code is needed. See [the guide](docs/guides/validation-framework.md#17-adding-a-completely-new-api).
- **New common validation:** add a validator and register it once in `src/validators/index.ts`.
- **Endpoint-specific logic:** assert a business rule in the module's `feature.spec.ts` (`recordBusinessRuleViolation`, which can set up the multi-step state a rule needs), or add a DB validation (`src/database/validations/`) and reference it from the definition.
- **UI:** import `test`/`expect` from `@fixtures`, keep locators in page objects, prefer role-based locators, and wait on a condition (`toBeVisible`, `waitForResponse`), not a fixed time — `waitForTimeout` is a lint warning, kept only where a spec was tuned live against this test-id-less SPA.

## CI

[.github/workflows/playwright.yml](.github/workflows/playwright.yml) runs `npm run check` (typecheck, lint, format) on every push and pull request. That is all CI does: the test suites run against the live application from the QA machine, where the credentials and the shared-server safety rules live, and every run files its bugs once from one serial process.

## Working notes

Read these in order:

1. [CLAUDE.md](CLAUDE.md) — the short map and rulebook: what is tested, the test flow, the repo structure,
   the run → Bugzilla pipeline, and every standing rule. Read it first.
2. [docs/guides/commands.md](docs/guides/commands.md) — every command.
3. [docs/reference/bench-reference.md](docs/reference/bench-reference.md) — the full detail: product, architecture, pipeline
   spec, contracts, plan and conventions.
4. [docs/reference/decision-log.md](docs/reference/decision-log.md) — every decision and incident, newest first. Add an entry at
   the top whenever a flow changes.

[docs/README.md](docs/README.md) indexes everything else, one line per document. The folders mean
what they say: `guides/` is how to operate the bench, `reference/` is what it is and tests against,
`modules/` and `ui/` are the analyses the specs were built from, `scope/` is the evidence behind every
blocked or unused endpoint, `generated/` is written by `npm run framework` and never hand-edited,
`audits/` holds dated snapshots, `api-specs/` holds the product owner's workbooks (the KPost workbook
`scripts/excel-to-contract.cjs` converts, and the Admin workbook and PDF), and `archive/` keeps
superseded plans only because other comments cite them.

Keep `CLAUDE.md` short (under ~200 lines, since it is loaded into every Claude session): rules and the map go
there, history goes in the decision log.
