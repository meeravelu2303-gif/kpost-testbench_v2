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
- **`kmail`** — every KMail API endpoint on the **test** host, **all test types** (`TEST_DB_MODE`) + the compose/draft/settings write lifecycle.
- **`admin`** — every Admin API endpoint, **all test types** + the org-build write lifecycle (needs the business accounts).
- **`ui`** — the whole UI on **all three browsers (Chromium, Firefox, WebKit)**, run sequentially, in four layers:
  1. **static screen sweep** — every screen at rest (crash, broken asset, render budget, responsive, a11y, raw `undefined`/`NaN`);
  2. **interaction sweep** — search, scroll, open a conversation, and a **hang detector**, on every screen;
  3. **systematic crawl** — clicks **every control** on every screen (including write actions, since the
     target is the disposable test app) and **fuzzes every input** (long strings, emoji, `<script>`,
     injection-shaped, huge numbers) watching for a crash/freeze/corruption — the automated "better than a
     manual tester" pass;
  4. **targeted scenarios** — e.g. continuous-send (five messages in one session, no refresh).

  The crawl exercises real write paths on the test environment; the only thing it refuses is a control that
  would log it out or delete the account (so the run can finish). It leaves test data behind — **reset the
  test DB periodically.** The report breaks results down **per browser**, and each filed bug records the
  **browser name** (`[browser:…]` + a "Browsers affected" line), so a WebKit- or Firefox-only defect is
  unmistakable.

- **`all`** — `kpost`, then `kmail`, then `ui`, in order (separate runs, so the API login never displaces the UI session).

Each run writes the single report (see §4). All are serial (`--workers=1`).

---

## 2. Deep write-fuzzing — the whole disposable test DB

The plain commands fuzz **reads** and drive writes through their safe lifecycle. The `:deep` tier also
runs the fuzz/attack matrix **on write endpoints** (bad input, injection, malformed payloads on the
writes themselves). It **persists junk**, so it is for the throwaway test DBs only:

| Run (files nothing)  | File the bugs             |
| -------------------- | ------------------------- |
| `npm run kpost:deep` | `npm run kpost:deep:file` |
| `npm run kmail:deep` | `npm run kmail:deep:file` |
| `npm run admin:deep` | `npm run admin:deep:file` |

The OTP/SMS kill-switch and the QA-identifier guard stay armed even here, and `external` writes (real
SMS/email) stay blocked. **Reset/reseed the test DB after a deep run**, and after a full `npm run ui`
(the UI crawler exercises real writes on the test app — see §1 layer 3).

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
