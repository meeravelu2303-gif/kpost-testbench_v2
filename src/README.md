# src/ — the framework

Shared code the tests are built on. No tests live here. Import through the path aliases
(`@api`, `@config`, `@engine`, `@validators`, `@fixtures`, `@pages`, `@ui`, `@reporting`, …).

| Folder               | Alias         | What it holds                                                                                                                                                              |
| -------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/client/`        | `@api`        | The HTTP client, request builder, response wrapper and the token provider (login + token cache).                                                                           |
| `api/definitions/`   | `@api`        | **One definition per endpoint**, by product and module: `kpost/<module>/`, `kmail/`, `admin/`. This is where a new endpoint is added.                                      |
| `api/registry/`      | `@api`        | The endpoint registry and the `EndpointDefinition` type.                                                                                                                   |
| `api/contract/`      | `@api`        | Lookups into the generated `openapi/` and `contracts/` files (request examples, response schemas, type codes).                                                             |
| `api/schema/`        | `@api`        | Schema helpers (zod / JSON Schema) used by the response validators.                                                                                                        |
| `validation-engine/` | `@engine`     | The engine that runs every validator on an endpoint, plus the safety guards: `production-guard.ts` (no unsafe writes) and `qa-identifier-guard.ts` (QA data only).         |
| `validators/`        | `@validators` | The common checks, one file each, by kind: `authentication/`, `authorization/`, `request/`, `response/`, `security/`, `performance/`, `common/`. Registered in `index.ts`. |
| `bug-tracker/`       | —             | Everything from a failed test to a Bugzilla bug, one folder per step: `findings/`, `gates/`, `ticket/`, `bugzilla/`, `status/`, `filing/` (its own README).                |
| `reporting/`         | `@reporting`  | The run report: execution summary, report formatting and attachments, and archiving the previous `reports/REPORT.*` to `reports/history/`.                                 |
| `config/`            | `@config`     | Settings: `env.ts` (every `.env` variable, validated), auth profiles, hosts, timeouts and thresholds, bug ownership per module, tags.                                      |
| `fixtures/`          | `@fixtures`   | The custom Playwright `test` and `expect` every spec imports, the QA account registry, and sample upload files.                                                            |
| `pages/`             | `@pages`      | UI page objects (login, signup, home, settings, admin).                                                                                                                    |
| `ui/`                | `@ui`         | UI helpers: the screen registry, the crawler and screen checks, accessibility evidence, failure diagnostics.                                                               |
| `database/`          | `@database`   | Read-only database checks (MySQL for KPost/KMail, MongoDB for Admin) and named DB validations.                                                                             |
| `business-rules/`    | `@rules`      | The registry of product business rules the feature specs assert.                                                                                                           |
| `utils/`             | `@utils`      | Small helpers: logger, secret masking, JWT decoding, JSON paths, correlation ids.                                                                                          |
