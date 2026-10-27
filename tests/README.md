# tests/ — every test, by product

Run them through the product commands in `docs/guides/commands.md`, not by folder.

| Folder                      | Bugzilla product | What it holds                                                                                                                                                                   |
| --------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/kpost/`                | KPost API        | One folder per module (`katchup/`, `kall/`, `group/`, `profile/`, …) plus `security/`. `feature.spec.ts` in a module is its full lifecycle flow.                                |
| `api/kmail/`                | KMail API        | `contract.spec.ts` (every endpoint through the engine) plus the workflow and security specs.                                                                                    |
| `api/admin/`                | KPost Admin      | By test kind: `engine/`, `flows/`, `validation/`, `security/`, `performance/`, `maintenance/` (one-time setup), `support/` (shared payloads).                                   |
| `api/smoke/`, `api/sanity/` | —                | The quick health checks behind `npm run test:smoke` / `test:sanity`. They never file bugs.                                                                                      |
| `e2e/`                      | KPost UI         | One folder per module (`katchup/`, `kmail/`, `settings/`, …), plus `platform/` (accessibility, visual, resilience), `journeys/` (end-to-end user stories), `smoke/`, `sanity/`. |
| `e2e-admin/`                | KPost Admin UI   | One folder per Admin menu area (`admin-setup/`, `human-resources/`, `screens/`, …).                                                                                             |
| `setup/`                    | —                | Logs each QA account in once and saves the session to `.auth/` for the UI tests.                                                                                                |
| `framework/`                | —                | The bench's own self-tests: safety guards, filing gates, routing, coverage ledgers. `npm run framework`.                                                                        |

`support/` folders hold helpers for the specs next to them; they contain no tests.

**Do not move or rename a UI spec** (`e2e/`, `e2e-admin/`): its file path is part of each bug's identity in
Bugzilla, so a move makes the bench refile its bugs as new ones.
