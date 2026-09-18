# Run commands

Run everything from the repo root (`D:\TEST-BENCH-AUTOMATIONS\kpost-testbench_v2`) in **PowerShell**.

There are only two kinds of command:

- **Run the tests** — runs the checks, shows pass/fail, **files no bugs**. For seeing that things work.
- **File the bugs** — runs the checks **and creates the valid, non-duplicate bugs in Bugzilla**.

Each kind comes in an **API** flavour and a **UI** flavour, plus a **run-all**. That's the whole file.

---

## 1. Run the tests (no bugs filed)

Use these to just run the checks and see the result. Nothing is written to Bugzilla.

| What              | Command                 |
| ----------------- | ----------------------- |
| **API tests**     | `npm run test:api`      |
| **UI tests**      | `npm run test:chromium` |
| **Run all tests** | `npm run test`          |

Narrower API runs, if you want one module:

| What           | Command              |
| -------------- | -------------------- |
| KPost API only | `npm run test:kpost` |
| KMail API only | `npm run test:kmail` |

---

## 2. File the bugs to Bugzilla

**Always preview first, then file.** `preview` finds the bugs and writes the report but creates
nothing; `file` creates the tickets. They are otherwise identical. Filing **cannot be undone**
(Bugzilla has no delete), so read the report in between.

### 2a. API bugs → Jaganathan (KPost) + Jitendra (KMail)

```powershell
npm run bugs:preview:api     # 1. find API bugs, file NOTHING — then read reports/REPORT.md
npm run bugs:file:api        # 2. file the valid API bugs
```

Want them filed **in order** — KPost first (lower ids), then KMail (higher ids)? Use the per-module
commands instead (each is serial, so the ids come out ascending):

```powershell
npm run bugs:preview:kpost   # KPost API — preview, read REPORT.md, then file
npm run bugs:file:kpost
npm run bugs:preview:kmail   # KMail API — preview, read REPORT.md, then file
npm run bugs:file:kmail
```

### 2b. UI bugs → Ayyappan

```powershell
npm run bugs:preview:ui      # 1. find UI bugs, file NOTHING — then read reports/REPORT.md
npm run bugs:file:ui         # 2. file the valid UI bugs
```

---

## 3. Run all — API + UI together, and file

```powershell
npm run bugs:preview         # 1. API + UI, find everything, file NOTHING — read reports/REPORT.md
npm run bugs:file            # 2. API + UI, file all the valid bugs (KPost ids first, then KMail, then UI)
```

This is the one-shot "test everything and file" command. ~5 min.

---

## 4. The full end-to-end run (also drives the write flows)

Sections 1–3 run the **read-side** checks (status codes, schemas, security headers, sensitive-data,
performance, auth) — the safe-on-live checks that produce the fileable bugs. To **also** exercise every
**write lifecycle** (Katchup send/recall/delete, KMail compose, Profile edit, Kall, Contacts, Group,
Settings, KDiary, KOS, AWS — all on the QA accounts, self-cleaning):

```powershell
npm run flow:preview         # API reads + writes + UI sweep, file NOTHING — read reports/REPORT.md
npm run flow:file            # same, and file the valid bugs
```

API only (no UI), reads + writes:

```powershell
npm run flow:preview:api
npm run flow:file:api
```

This is the fullest live run (~10–15 min, serial).

---

## Quick reference — every command

| Goal                             | Preview (files nothing)                 | File for real                        |
| -------------------------------- | --------------------------------------- | ------------------------------------ |
| **API** — run tests              | `npm run test:api`                      | —                                    |
| **API** — file bugs              | `npm run bugs:preview:api`              | `npm run bugs:file:api`              |
| **API** — file, KPost then KMail | `npm run bugs:preview:kpost` / `:kmail` | `npm run bugs:file:kpost` / `:kmail` |
| **UI** — run tests               | `npm run test:chromium`                 | —                                    |
| **UI** — file bugs               | `npm run bugs:preview:ui`               | `npm run bugs:file:ui`               |
| **ALL** — API + UI, file         | `npm run bugs:preview`                  | `npm run bugs:file`                  |
| **ALL** — reads + writes + UI    | `npm run flow:preview`                  | `npm run flow:file`                  |

---

## After any run — where the results are

| File                             | What it is                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reports/REPORT.md`              | **The main output.** Part 1 execution health (pass/fail/skip by module + UI), Part 2 the bug report (every valid defect by developer + everything dropped and why). |
| `reports/REPORT.json`            | The structured companion: run summary + quality gate + the `bugs` object (full candidate text, useful on a preview run).                                            |
| Bugzilla (`http://192.168.0.50`) | The created tickets (after a `:file` command).                                                                                                                      |
| `npm run report`                 | The full Playwright HTML report — per-test detail, traces, screenshots.                                                                                             |

---

## What "a valid bug" means (why you can trust `:file`)

A ticket is created only if **all** of these hold; anything dropped is listed in `REPORT.md` **with the
reason**, so nothing is hidden:

| Filter         | Rule                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Severity floor | MEDIUM or higher. LOW findings are reported, not filed.                                                                       |
| Validity gate  | Infrastructure cascades and self-contradicting evidence are dropped.                                                          |
| No duplicates  | Live `[KP-XXXXXX]` tag search: already open → **comment**; resolved INVALID → **never re-file**; fixed but back → **reopen**. |
| Run gate       | If the run collapsed (< 50% of tests produced a result), **nothing** files.                                                   |
| Consolidation  | One platform-wide fault (e.g. missing headers everywhere) = **one** ticket listing all endpoints.                             |

**Routing:** KPost API → Jaganathan Murthy · KMail API → Jitendra Kumar · UI → Ayyappan Ashok, each on
its exact component.

---

## What never runs on live (safety, by design)

No command sends these to the live app, whatever you run:

- **OTP flows** (signup, forgot-password, device changes) — they send real SMS; live has no bypass.
- **Aggressive fuzzing** (injection, XSS, boundary/type mutation) — they mutate and re-send, so they run
  only against the local mock / a staging host.
- Anything naming **another real user's data** — refused by the QA-identifier guard before it is sent.

Every write flow targets the **QA accounts only** and cleans up after itself.

---

## Prerequisites — confirm once in `.env`

```
TEST_ENV=production            # targets live + arms the 3 safety controls (do not change)
MOCK_API=false                 # hit the real API
BUGZILLA_URL=http://192.168.0.50/rest
BUGZILLA_API_KEY=<a 40-char key>   # REQUIRED to file — if empty, a :file command runs but files nothing (and says so)
BUGZILLA_MIN_SEVERITY=MEDIUM   # the valid-only floor
```

Healthcheck (no live calls, ~15s): `npm run check` then `npm run test:framework`.

---

## Note on the gated UI feature flows

The UI **write/feature** specs (Katchup send, recall, two-session, KMail send, Kall schedule, …) are
**gated** behind their own `*_UI_LIFECYCLE` flags and are **not** part of any command above — they are
functional tests, not bug-finders, so they never file to Bugzilla. Run one on demand like:

```powershell
$env:KATCHUP_UI_LIFECYCLE="true"; $env:BUGZILLA_DRY_RUN="true"
npx playwright test --project=chromium tests/e2e/katchup-two-session.spec.ts
```

UI bug-filing is handled by `bugs:file:ui` (the screen sweep), not by these gated specs.
