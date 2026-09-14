# Runbook — testing the whole KPost application, production-grade

This is the step-by-step playbook for a complete, safe, production-grade run: verify the bench,
drive every flow on the live app, file valid non-duplicate bugs to the right developer, and read the
results. Run the phases in order. Commands are `npm run …` from the repo root.

---

## 0. What makes this production-grade (the guarantees)

Before running, know what the bench promises — these are the properties that make the run
trustworthy, not just "green":

- **Safety, default-deny.** On the live app (`TEST_ENV=production`) three independent controls arm:
  an endpoint allowlist (only `productionSafe` reads run unguarded), a validator allowlist (no
  request that mutates and re-sends is ever aimed at live), and the QA-identifier guard (no request
  may name a record we do not own — checked before it is sent). None can be switched off by config.
- **Writes are authorized, scoped, and self-cleaning.** Every write runs only through a gated
  lifecycle flow (`*_LIFECYCLE`), on QA accounts only, and deletes/restores what it made — the
  accounts end the run as they started.
- **Only valid, non-duplicate bugs are filed.** A validity gate drops infrastructure noise and
  below-severity findings; a live search on the `[KPV2-…]` tag means a re-run **comments** on an
  existing ticket, never duplicates; systemic faults are consolidated into one ticket that lists
  every endpoint they hit.
- **Nothing is silently missed or misrouted.** The coverage ledger accounts for every documented
  endpoint and screen; component routing sends each bug to the correct Bugzilla component and
  developer (KPost API → Jagan, KMail → Jitendra, UI → Ayyappan). Both are self-checking tests.

---

## 1. Preflight — check the configuration (once, and after any `.env` change)

`.env` must have:

| Key                                 | Value                                                               |
| ----------------------------------- | ------------------------------------------------------------------- |
| `TEST_ENV`                          | `production`                                                        |
| `KPOST_API_BASE_URL`                | `https://devapi2.kpostindia.com`                                    |
| `KMAIL_API_BASE_URL`                | `https://kmail5.kpostindia.com`                                     |
| `BASE_URL`                          | `https://account.kpostindia.com/`                                   |
| `BUGZILLA_URL` / `BUGZILLA_API_KEY` | set (the live instance)                                             |
| `BUGZILLA_DRY_RUN`                  | `false` (to file) — the run commands below also set this explicitly |
| `BUGZILLA_MAX_FILE`                 | `0` (unlimited — file every valid bug)                              |
| `BUGZILLA_MIN_SEVERITY`             | `MEDIUM` (LOW findings are not filed)                               |
| `QA_KPOST_ID` …                     | the 6 QA PERSONAL accounts, verified to log in                      |

The 6 QA accounts must exist and log in on live. Browsers must be installed
(`npm run install:browsers`, one-time).

---

## 2. Verify the bench itself (test the tester first)

A production-grade run never trusts a bench it hasn't checked. All of these are offline / no live
writes:

```bash
npm run check           # typecheck + lint + format — must be clean
npm run test:framework  # the self-tests: safety controls, coverage ledger, ownership,
                        # component routing, dedup/validity — all must pass
```

If the workbook (`KPOST API (N).xlsx`) changed, regenerate the contracts first:

```bash
npm run contract:excel && npm run contract:coverage && npm run contract:gaps && npm run contract:otp
```

Do not proceed while any of these fail — a bench that can't prove itself sound can't be trusted about
the app.

---

## 3. Dry preview on live (drive everything, write nothing lasting, file nothing)

```bash
npm run flow:preview
```

This runs the **complete flow** against the live app — all reads, all 10 write lifecycles
(create → act → clean up), and the UI screens — **serial** (`--workers=1`), but files **nothing**.
Use it to confirm the flows drive cleanly and to review what _would_ be filed. Check:

- `reports/bugs/REPORT.md` — endpoints tested, valid defects, what would file, by developer.
- `reports/validation/summary.md` — per-endpoint pass/fail.

The write flows self-clean, so this leaves your QA accounts unchanged.

---

## 4. The full run — writes + filing

```bash
npm run flow:file
```

Same complete flow, and it **files** valid non-duplicate bugs to Bugzilla, each on its correct
component and developer. Serial. Self-cleaning. This is the production-grade end-to-end run.

- Run it **one at a time** — never two bench runs at once (they share one live login session).
- The metered K-AI calls stay **off** (they cost money). To include them once, prefix
  `KOS_AI_LIVE=true`.

For a lighter run (reads + UI + filing, no write flows) use `npm run bugs:file` instead.

---

## 5. Read the results

| File                            | What it tells you                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `reports/bugs/REPORT.md`        | The bug report: run totals, valid defects, filed-by-developer, every ticket, and what was rejected (with the reason). |
| `reports/validation/summary.md` | Per-endpoint pass / fail / skip.                                                                                      |
| `docs/COMPONENT-ROUTING.md`     | Every endpoint → its Bugzilla component (regenerated each framework run).                                             |
| `docs/COVERAGE.md`              | Every documented endpoint & screen, with its scope decision.                                                          |
| `docs/LIVE-ENDPOINTS.md`        | What runs on live vs blocked, with the reason.                                                                        |
| Bugzilla                        | The filed tickets themselves, on their components, assigned to the developer.                                         |

`npx playwright show-report` opens the HTML report (traces/screenshots for UI failures).

---

## 6. Re-runs and cadence

- **Re-run any time.** Dedup means a re-run comments on tickets that still reproduce and creates only
  genuinely new ones — no duplicates.
- **A good cadence** is one full `flow:file` per build (or nightly), plus `bugs:file` for a quick
  read-only pass. Always serial.
- **Never hand-edit the `[KPV2-…]` tag** in a ticket summary — it is how the next run finds and
  updates that ticket instead of duplicating it. Resolving, commenting, reassigning is all fine.

---

## 7. Coverage boundaries — and how to close them

What `flow:file` covers on live: **every endpoint except the ones that cannot run safely on
production** — plus every screen, filed to the right owner.

| Class                                                                                | Runs on live?           | To get it                                              |
| ------------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------ |
| Reads (status, schema, headers, sensitive-data, performance, auth)                   | ✅                      | already on                                             |
| Write flows (create / act / delete, self-cleaning)                                   | ✅                      | `*_LIFECYCLE` (the `flow:*` commands)                  |
| UI screens, cross-browser                                                            | ✅                      | the browser projects                                   |
| **Input validation on READS** (null / type / boundary / enum / required / malformed) | ✅                      | on — a read persists nothing; the id-guard confines it |
| **Input validation on WRITES**                                                       | ❌ (writes junk)        | a **dev/staging KPost host** safe to fuzz              |
| **Attacks** (injection / XSS / cross-tenant / rate / payload-size)                   | ❌ (could harm others)  | a dev/staging host                                     |
| **OTP-gated flows** (signup, device changes)                                         | ❌ (no OTP bypass)      | a dev/staging host                                     |
| **Account-destroying** (change password, deactivate, logout-all)                     | ❌ (breaks the account) | left blocked                                           |

**Input validation now runs on live for READ endpoints** — a read can't change data, and the
identifier guard refuses any mutated value that names a record outside our QA accounts, so it's safe
and it finds the wrong-handling class (null accepted as a number, wrong type accepted, …) on live.
Fuzzing **writes**, the **attack** class, and the **OTP** flows still need a **non-production KPost
deployment** (set its URL and run with `TEST_ENV=dev`), because those either persist junk, could harm
other users, or need an OTP bypass. Ask the developers for that host.

---

## 8. Safety rules (never break these)

1. **Serial only** on live — one bench run at a time; concurrent logins answer 500.
2. **QA accounts only** — every write targets an account we own; the identifier guard enforces it.
3. **Fuzz reads, never writes, on production** — input-validation fuzzers run on live READ endpoints
   (safe: no persistence, id-guard confines them); the write-fuzzers and every attack validator stay
   blocked on live — run those on a dev host.
4. **Dry-preview a new kind of run first** (`flow:preview`) before its filing variant.
5. **Bugzilla has no undo** — that is why filing is gated behind the validity gate, the severity
   floor, and tag-dedup, and why the run gate blocks a collapsed run from filing at all.
