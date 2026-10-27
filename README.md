# kpost-testbench_v2

The test automation bench for the KPOST application (chat, calling, mail and admin under one login),
built on [Playwright](https://playwright.dev) and TypeScript. It tests the APIs and the UIs on the
**test deployment**, and files the real defects it finds to Bugzilla, routed to the developer who
owns the module.

- **API tests:** an endpoint is defined once, and every common validator (authentication,
  authorization, status, request, response schema, headers, errors, performance, security) applies
  to it automatically. See [docs/guides/validation-framework.md](docs/guides/validation-framework.md).
- **UI tests:** page objects, on Chromium, Firefox and WebKit, for the KPost app and the Admin app.
- **Bug filing:** deduplicated against Bugzilla, validity-gated, never refiled once a person closes a
  bug, and dry-run by default. See [docs/guides/bug-filing.md](docs/guides/bug-filing.md).

## Products

Declared once in [src/config/ownership.config.ts](src/config/ownership.config.ts):

| Bugzilla product | Tests             | Host (from `.env`)   | Owner             |
| ---------------- | ----------------- | -------------------- | ----------------- |
| KPost API        | `tests/api/kpost` | `KPOST_API_BASE_URL` | Jaganathan Murthy |
| KMail API        | `tests/api/kmail` | `KMAIL_API_BASE_URL` | Jitendra Kumar    |
| KPost Admin      | `tests/api/admin` | `ADMIN_API_BASE_URL` | Karan S           |
| KPost UI         | `tests/e2e`       | `BASE_URL`           | Ayyappan Ashok    |
| KPost Admin UI   | `tests/e2e-admin` | `ADMIN_UI_BASE_URL`  | Ayyappan Ashok    |

## Getting started

Requires Node.js 22.18 or newer (24 recommended, see `.nvmrc`).

```bash
npm ci
npm run install:browsers
cp .env.example .env        # then fill in the hosts and the QA accounts (see the comments inside)
npm run framework           # the bench's own self-tests: no host or credentials needed
npm run preflight           # .env complete, hosts and Bugzilla reachable
```

## Running

Every command, one section per product: **[docs/guides/commands.md](docs/guides/commands.md)**. In short:

```bash
npm run product:kpost-api          # preview: runs everything, files nothing
npm run report:filing              # read what would be filed
npm run product:kpost-api:file     # the same run, filing to Bugzilla
```

The same pair exists for `kmail-api`, `kpost-admin`, `kpost-ui`, `kpost-admin-ui` and `all`.
Results: `reports/REPORT.md`; earlier runs in `reports/history/`.

## Layout

```
src/            the framework: API client + endpoint definitions, validation engine, validators,
                page objects, fixtures, config, database checks, Bugzilla filing, reporting
tests/api/      API tests:  kpost/<module>  kmail/  admin/<test kind>  smoke/  sanity/
tests/e2e/      KPost UI tests, one folder per module (+ platform/, journeys/, smoke/, sanity/)
tests/e2e-admin/ Admin UI tests, one folder per menu area
tests/setup/    logins that save the browser sessions
tests/framework/ the bench's self-tests
contracts/, openapi/   generated from the API workbook (docs/api-specs/); never hand-edited
scripts/        command-line tools behind the npm commands
docs/           guides, reference, module notes; index in docs/README.md
```

## CI

[.github/workflows/playwright.yml](.github/workflows/playwright.yml) runs `npm run check` (typecheck,
lint, format) and the tag lint on every push and pull request. The test suites themselves run from the
QA machine, where the credentials and the shared-server safety rules live.

## Read next

1. [CLAUDE.md](CLAUDE.md): the map and every standing rule.
2. [docs/guides/commands.md](docs/guides/commands.md): every command.
3. [docs/reference/decision-log.md](docs/reference/decision-log.md): every decision, newest first.
