# kpost-testbench_v2

The KPost test bench automation framework, built on [Playwright](https://playwright.dev) and TypeScript. It contains:

- **A centralized API validation framework.** You define an endpoint once, and 44 common validators (auth, authz, status, request, response, schema, headers, errors, performance, security, data conventions) apply automatically. See **[docs/validation-framework.md](docs/validation-framework.md)**.
- **UI end-to-end tests** built on the Page Object Model, running on Chromium, Firefox and WebKit.
- **Automatic Bugzilla filing, routed to the right developer.** Real failures become tickets — deduplicated, validity-gated, never re-filed once a human closes them, and assigned to the module's maintainer (KMail → Jitendra, KPost API and Admin → Jagan, KPost UI → Ayyappan). Dry run by default. See **[docs/bug-filing.md](docs/bug-filing.md)**.

- **Contracts come from the Excel workbook**, not from swagger. One script converts it into separate KPost and KMail contracts plus generated OpenAPI, excluding anything invalid or duplicated. See **[docs/api-contracts.md](docs/api-contracts.md)**.

## Modules

KPost is one product built from separately maintained modules. Each suite targets its own host and owns where its defects go — declared once in [src/config/ownership.config.ts](src/config/ownership.config.ts):

| Suite       | Module                | Base URL             | Bugzilla product | Owner             |
| ----------- | --------------------- | -------------------- | ---------------- | ----------------- |
| `kpost-api` | KPost core API        | `KPOST_API_BASE_URL` | KPost API        | Jaganathan Murthy |
| `admin-api` | Admin module          | `ADMIN_API_BASE_URL` | KPost Admin      | Jaganathan Murthy |
| `kmail-api` | KMail module          | `KMAIL_API_BASE_URL` | KMail API        | Jitendra Kumar    |
| `kpost-ui`  | KPost React front end | `BASE_URL`           | KPost UI         | Ayyappan Ashok    |

## Stack

- **@playwright/test**: runner, browsers, API requests
- **TypeScript** (strict) with path aliases
- **zod + Ajv (JSON Schema 2020-12)**: contracts, response validation, negative-case generation, OpenAPI import
- **dotenv**: per-environment configuration, validated at startup
- **ESLint** (typescript-eslint + eslint-plugin-playwright) and **Prettier**
- **GitHub Actions**: quality gate, sharded runs, merged HTML, JUnit and validation reports

## Project structure

```
.
├── playwright.config.ts          # Projects, reporters, mock API web server, prod safety
├── merge.config.ts               # CI: merge sharded reports
├── openapi/                      # OpenAPI documents (contract-first endpoints)
├── mock-server/                  # Local in-memory KPost API stand-in (MOCK_API=true)
├── src/
│   ├── config/                   # env, api, auth, database and threshold configuration
│   ├── api/
│   │   ├── client/               # api-client, request-builder, response-wrapper, token-provider
│   │   ├── registry/             # api-registry, endpoint-definition, endpoint-loader (OpenAPI)
│   │   ├── schema/               # contract-schema (zod / JSON Schema → Ajv)
│   │   ├── schemas/              # request/response contracts
│   │   └── definitions/          # ENDPOINT DEFINITIONS: users, companies, auth, health, dictionary
│   ├── validation-engine/        # engine, registry, context, result, policy, probe, prod guard
│   ├── validators/               # CENTRAL VALIDATORS (authentication, authorization, request,
│   │                             #   response, security, performance, common) + index.ts registry
│   ├── business-rules/           # Endpoint-specific rules (users/, companies/)
│   ├── database/                 # DB client, repositories, assertions, named DB validations
│   ├── bug-tracker/              # Candidate → validity gate → dedupe → Bugzilla filer/client
│   ├── reporting/                # Report formatter, attachment, Playwright validation reporter
│   ├── fixtures/                 # Custom `test` (engine, endpoints, api, pages, logger)
│   ├── data/                     # Test data factories
│   ├── pages/                    # UI page objects
│   ├── ui/                       # UI health, crawler, screens and breakage-sweep helpers
│   └── utils/                    # Structured logger, masking, correlation IDs, JSON helpers
└── tests/
    ├── api/                      # One thin spec per API area (endpoints come from the registry)
    ├── integration/              # Cross-endpoint workflows
    ├── framework/                # Self-tests proving the framework's guarantees
    ├── e2e/                      # UI specs
    └── setup/                    # UI auth setup
```

## Getting started

Requires Node.js 22.18 or newer (24 recommended, see `.nvmrc`). The mock API runs `.ts` files directly using Node's built-in type stripping.

```bash
npm ci
npx playwright install --with-deps
cp .env.example .env        # optional: the defaults run against the bundled mock API
npm test
```

With `TEST_ENV=local` and no `API_BASE_URL`, Playwright starts the bundled mock KPost API (`mock-server/`) automatically. To target a real environment, set `API_BASE_URL` and `AUTH_PRINCIPALS`.

## Running tests

**Every command is in one place — [`docs/COMMANDS.md`](docs/COMMANDS.md).** One command per Bugzilla
product, each with a `:file` variant that also files bugs. The essentials:

| Command                                                           | What it does                                                                             |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm run product:kpost-api` / `product:kpost-api:file`            | KPost API — FULL profile, write-fuzz, lifecycle flows on the test DB (run / run + file). |
| `npm run product:kmail-api` / `product:kmail-api:file`            | KMail API — same tier.                                                                   |
| `npm run product:kpost-admin` / `product:kpost-admin:file`        | Admin API — the owner's PDF endpoints, same tier (Admin DB stays read-only).             |
| `npm run product:kpost-ui` / `product:kpost-ui:file`              | KPost UI on 3 browsers, then the Admin UI.                                               |
| `npm run product:all` / `product:all:file`                        | All four, in order.                                                                      |
| `npm run ui:chromium:file` · `ui:firefox:file` · `ui:webkit:file` | KPost UI, one browser per run.                                                           |
| `npm run kpost:full:verify`                                       | Re-check every open KPost API bug; file nothing new.                                     |
| `npm run framework`                                               | The bench's own self-tests.                                                              |
| `npm run check`                                                   | Typecheck + lint + format check (CI gate).                                               |

KDoc/KOS is paused and excluded from every command until the owner says it's ready.

Every run writes a single report — `reports/REPORT.md` (human: execution health + bugs) and
`reports/REPORT.json` (structured). See `docs/COMMANDS.md` for the full list and the safety notes.

## Environments

Configuration is resolved in this order (first wins): real environment variables, then `.env.<TEST_ENV>`, then `.env`. Supported environments are `local`, `dev`, `qa`, `staging` and `production`. Every variable is validated in [src/config/env.ts](src/config/env.ts), so bad configuration stops the run immediately. See [.env.example](.env.example).

**Production safety:** with `TEST_ENV=production`, data-mutating endpoints (POST/PUT/PATCH/DELETE, and `@destructive` tests) are blocked unless `ALLOW_DESTRUCTIVE_TESTS=true`. The engine enforces this for every request it sends, including setup calls and probes.

## Writing tests

- **New API endpoint:** add an `EndpointDefinition` in `src/api/definitions/`. No test code is needed. See [the guide](docs/validation-framework.md#17-adding-a-completely-new-api).
- **New common validation:** add a validator and register it once in `src/validators/index.ts`.
- **Endpoint-specific logic:** add a business rule (`src/business-rules/`) or a DB validation (`src/database/validations/`).
- **UI:** import `test`/`expect` from `@fixtures`, keep locators in page objects, prefer role-based locators, and never use `waitForTimeout`.

## CI

[.github/workflows/playwright.yml](.github/workflows/playwright.yml) runs on pushes and PRs (`REGRESSION`), nightly (`FULL`), and on manual dispatch (choose the environment and profile):

1. **quality**: `npm run check`
2. **test**: sharded runs (JSON logs, retries, traces on first retry)
3. **merge-reports**: HTML, JUnit and the validation summary (published to the job summary), then the **quality gate**

Configure `BASE_URL`, `API_BASE_URL`, `TEST_COMPANY_ID` and `MOCK_API=false` as variables. Configure `AUTH_PRINCIPALS`, `EXPIRED_TOKEN`, `DB_CONNECTION_STRING`, `APP_USERNAME` and `APP_PASSWORD` as secrets. Set them under _Settings → Environments_ for each environment.

## Working notes

Read these in order:

1. [CLAUDE.md](CLAUDE.md) — the short map and rulebook: what is tested, the test flow, the repo structure,
   the run → Bugzilla pipeline, and every standing rule. Read it first.
2. [docs/COMMANDS.md](docs/COMMANDS.md) — every command.
3. [docs/BENCH-REFERENCE.md](docs/BENCH-REFERENCE.md) — the full detail: product, architecture, pipeline
   spec, contracts, plan and conventions.
4. [docs/DECISION-LOG.md](docs/DECISION-LOG.md) — every decision and incident, newest first. Add an entry at
   the top whenever a flow changes.

Everything else in `docs/` is either generated (regenerate it, never hand-edit — each file says so
at the top) or a focused reference: [docs/BLOCKED-ENDPOINTS-RATIONALE.md](docs/BLOCKED-ENDPOINTS-RATIONALE.md)
and [docs/UNUSED-ENDPOINTS.md](docs/UNUSED-ENDPOINTS.md) are the hand-written "why" behind what
`docs/BLOCKED-ENDPOINTS.md` (generated) lists; `docs/reference/` holds source material supplied by
the product owner (the Admin module's PDF/Excel spec — the `KPOST API (N).xlsx` workbook itself
stays in the repo root, since `scripts/excel-to-contract.cjs` reads it from there by convention);
`docs/archive/` holds superseded planning documents, kept only because other comments cite them.

Keep `CLAUDE.md` short (under ~200 lines, since it is loaded into every Claude session): rules and the map go
there, history goes in the decision log.
