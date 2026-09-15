# Run commands — how to run the tests and file bugs to Bugzilla

Everything runs from the repo root (`D:\TEST-BENCH-AUTOMATIONS\kpost-testbench_v2`) in **PowerShell**.

---

## ⭐ If you only read one thing

To find API bugs on the live app and file them to Bugzilla:

```powershell
npm run bugs:preview     # 1. dry run — finds bugs, files NOTHING. Read reports/bugs/REPORT.md
npm run bugs:file        # 2. files the valid, non-duplicate bugs to Bugzilla
```

That's it. Everything below is detail on what those do and the other options.

---

## ⭐⭐ Run all APIs IN ORDER — KPost first, then KMail (ascending bug ids)

This is the recommended way to file: run **KPost API first** (its bugs get the lower ids), then
**KMail API** (higher ids), so the Bugzilla list reads top-to-bottom by module. Each module runs
**serial** (`--workers=1`) and files in a **deterministic order** (by component, then endpoint), so
the ids come out ascending, not random.

```powershell
# 1) KPOST API — preview, read the report, then file
npm run bugs:preview:kpost
#    ...read reports/bugs/REPORT.md...
npm run bugs:file:kpost

# 2) KMAIL API — preview, read the report, then file
npm run bugs:preview:kmail
#    ...read reports/bugs/REPORT.md...
npm run bugs:file:kmail
```

Result: KPost API bugs are created first (e.g. ids 100, 101, 102 …), then KMail API bugs after them
(103, 104 …) — ascending, grouped by module, valid and non-duplicate. Re-running either step later
**comments** on the existing tickets instead of duplicating.

> Each run writes a fresh `reports/bugs/REPORT.md` for that module, so read it between the KPost and
> KMail steps. The Bugzilla UI already lists bugs id-ascending, so they line up in order.

---

## ⭐⭐⭐ Test EVERYTHING end-to-end on live (reads + writes) and file bugs

The two commands above (`bugs:*`) run only the **read-side** checks. To also exercise every **write
lifecycle** (Katchup send/recall/delete, KMail compose/delete, Profile edit, Kall, Contacts, Group,
Settings, KDiary, KOS, AWS — all on the QA accounts, self-cleaning) in one end-to-end run:

```powershell
npm run flow:preview     # runs EVERYTHING on live, files NOTHING — read reports/bugs/REPORT.md
npm run flow:file        # runs EVERYTHING on live, files the valid bugs
```

`flow:file` runs KPost API + KMail API (reads **and** writes) + the UI screen sweep, serial, and files
the valid bugs — still **ascending by module** (KPost ids first, then KMail, then UI), because the
reporter sorts candidates by module before filing. This is the fullest live run. ~10–15 min.

**The hard ceiling — what CANNOT run on live, no matter the command (by design, for safety):**

- **OTP flows** (signup, forgot-password, device changes) — they send real SMS; live has no bypass.
- **Aggressive fuzzing probes** (injection, XSS, boundary/type mutation) — they mutate and re-send, so
  they only run against the local mock / a staging host, never live.
- Anything naming **another real user's data** — refused by the QA-identifier guard before it is sent.

So "all test cases on live" = **every read-side check + every write lifecycle** on the QA accounts.
The OTP and fuzzing classes are the only ones held back, and that is a safety property, not a gap —
they are covered off-live against the mock.

---

## 1. The mental model (what actually happens)

When you run a command, three things happen in order:

1. **Tests run** against the **live** app (`devapi2` for KPost API, `kmail5` for KMail, and/or the UI
   at `account.kpostindia.com`). Each endpoint/screen is checked by many validators.
2. Every failed check becomes a **candidate bug**. The bench then **filters** them (see §4) so only
   real, valid, non-duplicate ones survive.
3. If filing is **armed** (`bugs:file`), the survivors are **created in Bugzilla**, routed to the
   right developer. If filing is **dry** (`bugs:preview`), nothing is created — you just get a report.

**`DRY_RUN` is the switch.** `preview` = dry (files nothing). `file` = armed (creates tickets).
The two commands are otherwise identical.

---

## 2. Command reference — pick the row you want

| Command                      | What it runs                                                       | Files to Bugzilla?  | ~Time   |
| ---------------------------- | ------------------------------------------------------------------ | :-----------------: | ------- |
| `npm run bugs:preview`       | API (KPost + KMail) **+ UI screen sweep**, all at once             |  **No** (dry run)   | ~5 min  |
| `npm run bugs:file`          | API (KPost + KMail) **+ UI screen sweep**, all at once             |       **Yes**       | ~5 min  |
| `npm run bugs:preview:kpost` | **KPost API only**, serial (ordered)                               |  **No** (dry run)   | ~3 min  |
| `npm run bugs:file:kpost`    | **KPost API only** — files FIRST (lower ids)                       |       **Yes**       | ~3 min  |
| `npm run bugs:preview:kmail` | **KMail API only**, serial (ordered)                               |  **No** (dry run)   | ~2 min  |
| `npm run bugs:file:kmail`    | **KMail API only** — files AFTER KPost (higher ids)                |       **Yes**       | ~2 min  |
| `npm run test:kpost`         | KPost API endpoints only (no filing)                               | No (dry by default) | ~3 min  |
| `npm run test:kmail`         | KMail API endpoints only (no filing)                               | No (dry by default) | ~2 min  |
| `npm run flow:preview`       | API + **all write lifecycles** (send/recall/delete on QA accounts) |       **No**        | ~10 min |
| `npm run flow:file`          | API + **all write lifecycles**                                     |       **Yes**       | ~10 min |

Notes:

- `bugs:*` runs the **read-side** validators (status codes, schemas, security headers, sensitive-data,
  performance, auth) — the ones that are safe on live. This is where the fileable bugs come from.
- `flow:*` **also** drives every write flow (Katchup send/recall, KMail compose, etc.) on the **QA
  accounts only**, self-cleaning. More coverage, but slower and serial. Use it when you want the write
  paths exercised too, not just reads.
- `test:kpost` / `test:kmail` are for running **one module** quickly; they are **dry by default** (no
  filing) unless you add the env vars from §5.

---

## 3. First-time walkthrough (do this once, in order)

```powershell
# a) Confirm the bench is healthy (no live calls, ~15s)
npm run check
npm run test:framework

# b) DRY RUN — find the bugs, file nothing (~5 min)
npm run bugs:preview

# c) Read what it found — open this file:
#      reports/bugs/REPORT.md
#    It lists every valid defect grouped by developer, with evidence.

# d) When you are happy with the report, FILE for real (~5 min)
npm run bugs:file

# e) Check Bugzilla — the tickets are now there, routed to the right developer.
```

**Do (b) → (c) → (d) every time.** Never skip the preview: filing **cannot be undone** (Bugzilla has
no delete — the worst case is resolving a wrong ticket as INVALID by hand).

---

## 4. What counts as a "valid bug" (why you can trust it)

`bugs:file` creates a ticket only if **all** of these are true. Anything dropped is listed in
`REPORT.md` **with the reason**, so nothing is silently hidden:

| Filter         | Rule                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Severity floor | MEDIUM or higher (`BUGZILLA_MIN_SEVERITY=MEDIUM`). LOW findings are reported, not filed.                                                 |
| Validity gate  | Infrastructure cascades and self-contradicting evidence are dropped.                                                                     |
| No duplicates  | Live search on the `[KP-XXXXXX]` tag: already open → **comment**; resolved INVALID → **never re-file**; fixed but back → **reopen**.     |
| Run gate       | If the run collapsed (< 50% of tests produced a result), **nothing** files.                                                              |
| Consolidation  | One platform-wide fault (e.g. missing security headers on every endpoint) = **one** ticket listing all affected endpoints, not hundreds. |

**Routing:** KPost API → Jaganathan Murthy · KMail API → Jitendra Kumar · UI → Ayyappan Ashok — each
on its exact component.

---

## 5. Advanced: build your own command

Every command above is just `playwright test` with a few env vars. The two that matter:

- `BUGZILLA_DRY_RUN` — `true` = file nothing (preview), `false` = file for real.
- `MOCK_API` — `false` = hit the live API (always use false for real runs).

Examples (PowerShell):

```powershell
# API ONLY (skip the UI screen sweep), dry run
npx cross-env BUGZILLA_DRY_RUN=true MOCK_API=false playwright test --project=api

# API ONLY, file for real
npx cross-env BUGZILLA_DRY_RUN=false MOCK_API=false playwright test --project=api

# One module (KPost API) and file it
npx cross-env BUGZILLA_DRY_RUN=false MOCK_API=false playwright test --project=api --grep "@kpost-api"
```

The reporter reads `.env` for the rest (`TEST_ENV=production`, `BUGZILLA_URL`, `BUGZILLA_API_KEY`).

---

## 6. After a run — where to look

| File                             | What it is                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| `reports/bugs/REPORT.md`         | **The main output.** Every valid defect by developer + everything dropped and why. |
| `reports/bugs/filing.json`       | The full ticket text for each candidate (useful on a dry run).                     |
| Bugzilla (`http://192.168.0.50`) | The created tickets (after `bugs:file`).                                           |
| `npx playwright show-report`     | The full Playwright HTML report — per-test detail, traces, screenshots.            |

---

## 7. Prerequisites (already set — just confirm in `.env`)

```
TEST_ENV=production            # targets live + arms the 3 safety controls (do not change)
MOCK_API=false                 # hit the real API
BUGZILLA_URL=http://192.168.0.50/rest
BUGZILLA_API_KEY=<a 40-char key>   # REQUIRED to file — without it, nothing files
BUGZILLA_MIN_SEVERITY=MEDIUM   # the valid-only floor
```

If `BUGZILLA_API_KEY` is empty, `bugs:file` runs but files nothing (and says so).

---

## 8. The UI tests (separate from API filing)

The API commands above already include the **UI screen sweep** (`screens.spec.ts` — the 9 checks on
every screen), which is the part that finds and files UI bugs. The **UI feature/write flows**
(Katchup send, recall, two-session, etc.) are **gated** and only run when you set their flag — they do
**not** file bugs (they are functional tests, not bug-finders):

```powershell
# run a gated UI write flow (headed, dry — never files), e.g. the two-session recipient actions:
$env:KATCHUP_UI_LIFECYCLE="true"; $env:BUGZILLA_DRY_RUN="true"
npx playwright test --project=chromium tests/e2e/katchup-two-session.spec.ts
```

So: **`bugs:file` handles UI bug-filing** (via the screen sweep). The gated feature specs are for
verifying the flows work, run on demand, and never touch Bugzilla.
