# Commands — the one place for every command

Run everything from the repo root (`D:\TEST-BENCH-AUTOMATIONS\kpost-testbench_v2`) in **PowerShell**.

Every surface has **one command to run it**, and the same name with **`:file`** to also file bugs:

- **`npm run <surface>`** — runs the tests, writes the report, **files nothing** (safe to run any time).
- **`npm run <surface>:file`** — same, and **files valid, non-duplicate bugs** to Bugzilla + auto-resolves the ones now fixed.

Always run the plain command first, read `reports/REPORT.md`, then run `:file`. Filing cannot be undone.

---

## 1. Run one surface

| Surface        | Run (files nothing) | File the bugs        |
| -------------- | ------------------- | -------------------- |
| **KPost API**  | `npm run kpost`     | `npm run kpost:file` |
| **KMail API**  | `npm run kmail`     | `npm run kmail:file` |
| **Admin API**  | `npm run admin`     | `npm run admin:file` |
| **UI (e2e)**   | `npm run ui`        | `npm run ui:file`    |
| **Everything** | `npm run all`       | `npm run all:file`   |

What each one does:

- **`kpost`** — every KPost API endpoint, **all test types** (status, schema, auth, security, injection/XSS, performance, every input fuzzer) on the disposable **testingapi** test DB, plus the self-cleaning **write lifecycle flows** (Katchup, Kall, Profile, Contacts, Group, Settings, KDiary, KOS, AWS) — the full application flow.
- **`kmail`** — every KMail API endpoint: the full read matrix + the KMail compose/draft/settings write lifecycle.
- **`admin`** — every Admin API endpoint: reads + the org-build write lifecycle (needs the business accounts).
- **`ui`** — the whole UI: every screen (deep sweep) + every feature flow (Katchup, KMail, Kall, Settings, Group, Contacts, KDiary, Profile), with proof screenshots/videos on a `:file` run.
- **`all`** — `kpost`, then `kmail`, then `ui`, in order (separate runs, so the API login never displaces the UI session).

Each run writes the single report (see §4). All are serial (`--workers=1`).

---

## 2. Deep write-fuzzing — KPost only, disposable DB

`kpost` (above) fuzzes **reads** and drives writes through their safe lifecycle. To also run the
fuzz/attack matrix **on write endpoints** (it persists junk, so only on the throwaway test DB):

| Run (files nothing)  | File the bugs             |
| -------------------- | ------------------------- |
| `npm run kpost:deep` | `npm run kpost:deep:file` |

The OTP/SMS kill-switch, the QA-identifier guard, and the block on `external`/`global` writes stay
armed even here. Reset/reseed the test DB after a deep run.

---

## 3. Reconcile Bugzilla status only (file nothing new)

`npm run resolve` — runs the KPost checks and **closes the bugs it verified are fixed** (RESOLVED/FIXED
with a comment), without filing any new tickets. Use it to update statuses after the developers fix things.

---

## 4. After any run — where the results are

Every run writes **exactly two files**, nothing else:

| File                      | What it is                                                                                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`reports/REPORT.md`**   | The report. **Part 1** execution health (endpoints tested, pass/fail/skip/warn by module + UI). **Part 2** the bug report (valid defects by developer, and everything not filed, with the reason). |
| **`reports/REPORT.json`** | The same, structured (run summary + quality gate + the `bugs` object). Feeds the CI quality gate.                                                                                                  |

`npm run report` opens the full Playwright HTML report (per-test traces and screenshots).

---

## 5. Utilities

| Command                                                        | What it does                                                            |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `npm run check`                                                | typecheck + lint + format — must be clean before anything is "done".    |
| `npm run test:framework`                                       | the bench's own self-tests (safety, coverage, routing, payload guards). |
| `npm run test`                                                 | plain Playwright run against the local mock (no live target).           |
| `npm run test:headed`                                          | run with a visible browser (for debugging UI).                          |
| `npm run report`                                               | open the Playwright HTML report.                                        |
| `npm run codegen`                                              | record UI selectors.                                                    |
| `npm run mock:api`                                             | start the bundled mock KPost API.                                       |
| `npm run install:browsers`                                     | install the Playwright browsers (one-time).                             |
| `npm run contract:excel`                                       | regenerate the KPost/KMail contracts from the workbook.                 |
| `npm run contract:admin`                                       | regenerate the Admin contract from the live OpenAPI.                    |
| `npm run contract:coverage` / `contract:gaps` / `contract:otp` | audit contract coverage / gaps / OTP-gated endpoints.                   |

---

## 6. Safety — true on every command, cannot be switched off

- The target is the **disposable automation test DB** `testingapi.kpostindia.com` (`.env`).
- **No OTP/SMS/email** is ever sent to a real host — hard kill-switch, every mode.
- **No request names a record outside our QA accounts** — the QA-identifier guard refuses it before sending.
- **`external` / `global` writes** (account provisioning, another user's password, app version) stay
  **blocked on the live host** — only the disposable-DB deep tier fuzzes `data` writes.
