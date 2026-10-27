# scripts/ — the tools behind the npm commands

Run them through `npm run …` (see `docs/guides/commands.md`), not directly.

| Script                            | npm command                                    | What it does                                                                     |
| --------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `run-products.mjs`                | `product:all`, `product:all:file`              | Runs every product one after another, even when one finds failures.              |
| `run-level.mjs`                   | `test:smoke`, `test:sanity`, `test:regression` | Quick health checks by tag. Test hosts only; never files bugs.                   |
| `test-scope.mjs`                  | (used by `lint-tags.mjs`)                      | Which specs are in scope for the run levels.                                     |
| `lint-tags.mjs`                   | `lint:tags`                                    | Checks every test's tags and writes the traceability matrix `reports/rtm.xlsx`.  |
| `rtm-lib.mjs`, `rtm-assessed.mjs` | (used by `lint-tags.mjs`)                      | Builds the requirement → test matrix.                                            |
| `preflight.cjs`                   | `preflight`                                    | Before a run: `.env` complete, hosts and Bugzilla reachable, no run in progress. |
| `filing-plan.cjs`                 | `report:filing`                                | Prints what the last run would file, reopen, comment on and close.               |
| `file-reviewed.cjs`               | `bug:file-reviewed`                            | Files the "needs your review" findings you approved.                             |
| `file-approved.cjs`               | `bug:file-approved`                            | Files one finding from the last run by its id.                                   |
| `bugzilla-duplicate-check.cjs`    | `bug:dupe-check`                               | The duplicate search to run before filing a bug by hand.                         |
| `excel-to-contract.cjs`           | `contract:excel`                               | Builds `contracts/` and `openapi/` from the API workbook in `docs/api-specs/`.   |
| `contract-coverage.cjs`           | `contract:coverage`                            | Proves no workbook endpoint was lost in that conversion.                         |
| `fetch-admin-contract.cjs`        | `contract:admin`                               | Fetches the Admin API's own description from the Admin server.                   |
| `apply-admin-pdf-payloads.cjs`    | `contract:admin`, `contract:admin:pdf`         | Applies the owner's PDF payloads to the Admin contract.                          |
| `verify-test-accounts.cjs`        | `accounts:verify`                              | Checks the QA accounts exist and match `.env`.                                   |
| `provision-test-accounts.cjs`     | `accounts:provision`                           | Creates the `qatest` accounts on the test database (one-time).                   |
