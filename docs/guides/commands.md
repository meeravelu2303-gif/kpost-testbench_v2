# Commands — the one place for every command

Run everything from the repo root (`D:\TEST-BENCH-AUTOMATIONS\kpost-testbench_v2`) in **PowerShell**,
always through `npm run` (`cross-env` only resolves inside `npm run`; in a shell, set env vars natively).

Every command comes in two forms:

- **`npm run <name>`** — runs the tests, writes the report, **files nothing** (`BUGZILLA_DRY_RUN=true`).
- **`npm run <name>:file`** — same run, then **files valid, non-duplicate bugs** to Bugzilla, closes the ones
  it verified fixed, and puts a dated note on every other open bug of that product.

Run the plain command first, read `reports/REPORT.md`, then run `:file`. Filing cannot be undone.

**Before any command:** make sure no other run is in progress (never run Playwright during a live run),
and copy `reports/REPORT.json`/`.md` aside if the last run's report still matters — every run overwrites
them. Give the server a 25–40 min cool-down between long runs. Full rules: `CLAUDE.md` §5.

---

## 1. One command per Bugzilla product — the standard flow

| Product         | Run (files nothing)           | File the bugs                      | Runs                             |
| --------------- | ----------------------------- | ---------------------------------- | -------------------------------- |
| **KPost API**   | `npm run product:kpost-api`   | `npm run product:kpost-api:file`   | `kpost:full` / `kpost:full:file` |
| **KMail API**   | `npm run product:kmail-api`   | `npm run product:kmail-api:file`   | `kmail:full` / `kmail:full:file` |
| **KPost Admin** | `npm run product:kpost-admin` | `npm run product:kpost-admin:file` | `admin:full` / `admin:full:file` |
| **KPost UI**    | `npm run product:kpost-ui`    | `npm run product:kpost-ui:file`    | `ui:all` / `ui:all:file`         |
| **Everything**  | `npm run product:all`         | `npm run product:all:file`         | all four above, in order         |

What each one does:

- **`kpost:full`** — every KPost API endpoint, `VALIDATION_PROFILE=FULL` (every test type, security
  included), `WRITE_FUZZ` (fuzz/attack probes on writes too), destructive tests, the OTP test gateway, and the
  self-cleaning **write lifecycle flows** (Katchup, Kall, Profile, Contacts, Group, Settings, KDiary, AWS) on
  the disposable `testingapi` test DB. **KDoc/KOS is excluded** (paused: KOS dir left out + `--grep-invert @kos`).
- **`kmail:full`** — every KMail API endpoint, same FULL + write-fuzz + destructive tier, plus the
  compose/draft/settings lifecycle.
- **`admin:full`** — every Admin API endpoint (the owner's PDF list), FULL + write-fuzz + destructive, plus
  the org-build lifecycle. The Admin **database** is live and stays read-only in code whatever the flags.
- **`ui:all`** — `ui` (KPost UI on Chromium, Firefox and WebKit, KDoc screens excluded) then `ui:admin` (the
  Admin UI project). `ui` runs four layers on every screen:
  1. **static screen sweep** — crash, broken asset, render budget, responsive layout, a11y, raw `undefined`/`NaN`
     (split into 3 paced batch files to stay under the server's rate limiter);
  2. **interaction sweep** — search, scroll, open a conversation, and a **hang detector**;
  3. **systematic crawl** — clicks **every control** (write actions included, since the target is the test
     app) and **fuzzes every input**; it only refuses controls that would log out or delete the account;
  4. **targeted scenarios** — e.g. continuous-send (five messages in one session, no refresh).

  Each UI bug records its browser (`[browser:…]` whiteboard + "Browsers affected"). The crawl leaves test data
  behind — **reset the test DB periodically.**

## 2. Narrower runs

| Purpose                                                  | Run (files nothing)                         | File / write                                                      |
| -------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| KPost API, FULL profile but no write-fuzz/destructive    | `npm run kpost`                             | `npm run kpost:file`                                              |
| KMail API, all test types + lifecycle                    | `npm run kmail`                             | `npm run kmail:file`                                              |
| Admin API, all test types + lifecycle                    | `npm run admin`                             | `npm run admin:file`                                              |
| KPost UI, all 3 browsers                                 | `npm run ui`                                | `npm run ui:file`                                                 |
| **KPost UI, one browser per run** (preferred for filing) | —                                           | `npm run ui:chromium:file` · `ui:firefox:file` · `ui:webkit:file` |
| Admin UI only                                            | `npm run ui:admin`                          | `npm run ui:admin:file`                                           |
| Signup → login UI lifecycle (Chromium)                   | `npm run ui:signup`                         | `npm run ui:signup:file`                                          |
| Every `@database` check (API + Chromium)                 | `npm run db`                                | `npm run db:file`                                                 |
| Security-focused subset (FULL already includes it)       | `npm run kpost:security` · `kmail:security` | `npm run kpost:security:file`                                     |
| Visual snapshots (3 browsers) / refresh baselines        | `npm run ui:visual`                         | `npm run ui:visual:update`                                        |
| Old chained runs (`kpost`→`kmail`→`admin`→`ui`)          | `npm run all`                               | `npm run all:file`                                                |

Run WebKit in small file batches (`npx playwright test --project=webkit <files>`) — a long single WebKit run
can hang; kill a hung run with PowerShell `Stop-Process` on the real node PID.

## 3. Deep write-fuzzing tier

The `:deep` commands run the fuzz/attack matrix **on write endpoints**. They persist junk, so they are for the
throwaway test DBs only (`kpost:full` / `kmail:full` / `admin:full` already include the same write-fuzz):

| Run (files nothing)  | File the bugs             |
| -------------------- | ------------------------- |
| `npm run kpost:deep` | `npm run kpost:deep:file` |
| `npm run kmail:deep` | `npm run kmail:deep:file` |
| `npm run admin:deep` | `npm run admin:deep:file` |

`npm run admin:local-fuzz` — write-fuzz the legacy `tests/api/admin.spec.ts` against a local/test Admin only.

**Reset/reseed the test DB after a deep run** and after a full `npm run ui`.

## 4. Re-check existing bugs only (file nothing new)

| Command                     | What it does                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `npm run kpost:full:verify` | the full KPost API sweep in resolve-only mode: closes verified fixes, dates every other open bug. |
| `npm run resolve`           | lighter: every `@kpost-api` check, resolve-only.                                                  |

For a quick targeted re-test of a few bugs, grep their endpoint ids (`--grep "\[endpoint-id\]"`) — but
flow-triggered bugs (`flow.server-error`) and business rules inside `feature.spec.ts` need their lifecycle
spec run with its `*_LIFECYCLE` flag instead.

## 5. After any run — where the results are

| File                      | What it is                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`reports/REPORT.md`**   | **Part 1** execution health (pass/fail/skip by module + UI). **Part 2** the bug report: filed / commented / reopened / needs-review / auto-resolved, and every finding NOT filed with its reason. |
| **`reports/REPORT.json`** | The same, structured. Feeds the CI quality gate.                                                                                                                                                  |

`npm run report:summary` prints `REPORT.md`; `npm run report` opens the Playwright HTML report.
Traces, screenshots and videos land in `test-results*/` and `playwright-report*/` — gitignored, because traces
contain tokens and passwords. **Never commit them, and never write run logs into the repo** (use a temp folder).

## 6. Bugzilla and accounts utilities

| Command                            | What it does                                                                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run preflight`                | **run before any live run:** proves `.env` is complete, no other Playwright run is in progress, the hosts and Bugzilla answer, and backs up `reports/REPORT.*`. Exits non-zero on any hard failure. |
| `npm run bugzilla:dupe-check`      | the mandatory duplicate check before filing anything by hand.                                                                                                                                       |
| `npm run bug:preview` / `bug:file` | preview / file a hand-authored ticket (`tests/framework/manual-bug.spec.ts`).                                                                                                                       |
| `npm run accounts:verify`          | reconcile the QA account registry against the KPOST_QA database.                                                                                                                                    |
| `npm run accounts:provision`       | create the bench's `qatest_*` accounts on the KPOST_QA test database.                                                                                                                               |
| `npm run token:capture`            | capture a real access token now, to use later as `EXPIRED_TOKEN`.                                                                                                                                   |
| `npm run kpost:expired`            | the KPost pass with an aged (expired) token, cross-platform.                                                                                                                                        |

## 7. Development utilities

| Command                                                        | What it does                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `npm run check`                                                | typecheck + lint + format — must be clean before anything is "done".                                         |
| `npm run lint:fix` / `format` / `format:check`                 | fix lint, apply / check Prettier.                                                                            |
| `npm run framework`                                            | the bench's own self-tests, dry-run (safety, coverage, routing, payload guards).                             |
| `npm run test:framework`                                       | the same project without the dry-run flag.                                                                   |
| `npm run test` / `test:headed`                                 | plain Playwright run, every project, no flags / with a visible browser. Prefer a named command above.        |
| `npm run codegen`                                              | record UI selectors.                                                                                         |
| `npm run install:browsers`                                     | install the Playwright browsers (one-time).                                                                  |
| `npm run accounts:provision`                                   | create the `qatestN` accounts: no flag = status; `--send` then `--finish --from-db` (see the script header). |
| `npm run contract:excel`                                       | regenerate the KPost/KMail contracts from the workbook.                                                      |
| `npm run contract:admin` / `contract:admin:pdf`                | regenerate the Admin contract / apply the owner's PDF payloads.                                              |
| `npm run contract:coverage` / `contract:gaps` / `contract:otp` | audit contract coverage / gaps / OTP-gated endpoints.                                                        |

## 8. Safety — true on every command, cannot be switched off

- **KPost/KMail** target the disposable test DB (`testingapi.kpostindia.com`, `.env`); the **Admin DB is live**
  and refused any write in code.
- **No OTP/SMS/email** reaches a real person — hard kill-switch; `OTP_TEST_GATEWAY` only lifts it for
  `otpDependent` endpoints on the genuine test gateway.
- **No request names a record outside our QA accounts** — the QA-identifier guard refuses it before sending.
- **`external` / `global` writes** (real SMS/email, account provisioning, another user's password, app
  version) stay blocked; no flag unlocks them.
- **KDoc/KOS is excluded** from every command until the owner un-pauses it.
