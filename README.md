# kpost-testbench_v2

The KPost test bench automation framework, built on [Playwright](https://playwright.dev) and TypeScript. It contains:

- **A centralized API validation framework.** You define an endpoint once, and 44 common validators (auth, authz, status, request, response, schema, headers, errors, performance, security, data conventions) apply automatically. See **[docs/validation-framework.md](docs/validation-framework.md)**.
- **UI end-to-end tests** built on the Page Object Model, running on Chromium, Firefox and WebKit.
- **Automatic Bugzilla filing.** Real failures become tickets — deduplicated, validity-gated, and never re-filed once a human closes them. Dry run by default. See **[docs/bug-filing.md](docs/bug-filing.md)**.

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
│   ├── reporting/                # Report formatter, attachment, Playwright validation reporter
│   ├── fixtures/                 # Custom `test` (engine, endpoints, api, pages, logger)
│   ├── data/                     # Test data factories
│   ├── pages/                    # UI page objects
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

| Command                       | What it does                                                     |
| ----------------------------- | ---------------------------------------------------------------- |
| `npm test`                    | Everything (UI + API + integration + framework)                  |
| `npm run test:api:smoke`      | API contracts, `SMOKE` profile (happy-path checks, fast)         |
| `npm run test:api:regression` | API + integration, `REGRESSION` profile (negative probes, rules) |
| `npm run test:api:security`   | API, `SECURITY` profile (injection, XSS, JWT, rate limit, ...)   |
| `npm run test:api:full`       | API + integration, every validator                               |
| `npm run test:framework`      | Framework self-tests                                             |
| `npm run test:integration`    | Cross-endpoint workflows                                         |
| `npm run test:chromium`       | UI tests on Chromium only                                        |
| `npm run test:smoke`          | Tests tagged `@smoke`                                            |
| `npm run mock:api`            | Start the mock API manually                                      |
| `npm run bugs:preview`        | Dry run: print the bugs a run would file into Bugzilla           |
| `npm run bugs:file`           | File them for real (deduplicated against the live instance)      |
| `npm run report`              | Open the last HTML report                                        |
| `npm run check`               | Typecheck + lint + format check (CI gate)                        |

Every API run also writes `reports/validation/summary.{json,md}`. These list the results per endpoint and per validator, with correlation IDs.

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
