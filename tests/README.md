# tests/ — one folder per product

Each Bugzilla product has its own folder, and each product folder has its own `smoke/` and
`sanity/`. Run them through the product commands in `docs/guides/commands.md`, not by folder.

| Folder       | Bugzilla product | What it holds                                                                                                                                                         |
| ------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kpost-api/` | KPost API        | One folder per module (`katchup/`, `kall/`, `group/`, `profile/`, …) plus `security/`. A module's `feature.spec.ts` is its full lifecycle flow.                       |
| `kmail-api/` | KMail API        | `contract.spec.ts` (every endpoint through the engine), then by test kind: `engine/` (reads, coverage), `flows/` (feature flow, workflows), `security/` (IDOR, auth). |
| `admin-api/` | KPost Admin      | By test kind: `engine/`, `flows/`, `validation/`, `security/`, `performance/`, `maintenance/` (one-time setup), `support/` (shared payloads).                         |
| `kpost-ui/`  | KPost UI         | One folder per module (`katchup/`, `kmail/`, `settings/`, …), plus `platform/` (accessibility, visual, resilience) and `journeys/` (user stories).                    |
| `admin-ui/`  | KPost Admin UI   | One folder per Admin menu area (`admin-setup/`, `human-resources/`, `screens/`, …).                                                                                   |
| `setup/`     | —                | Logs each QA account in once and saves the session to `.auth/` for the UI tests.                                                                                      |
| `framework/` | —                | The bench's own self-tests: safety guards, coverage ledgers, validators. `framework/bug-tracker/` holds every bug-filing self-test. `npm run framework`.              |
| `support/`   | —                | Helpers shared by products: API smoke checks, attachments, `flow-state` / `live-condition` (only a blocker stops a test).                                             |

A `support/` folder inside a product holds helpers for that product's specs only.

**UI bug identity:** a UI bug's Bugzilla tag is hashed from its spec path. The UI folders were renamed
from `e2e/` and `e2e-admin/` on 2026-10-27, and the old names are still what gets hashed
(`uiFingerprintPath` in `src/bug-tracker/findings/bug-fingerprint.ts`), so every existing bug kept its tag.
Renaming a single UI spec file still changes its bugs' tags, so don't rename UI spec files.
