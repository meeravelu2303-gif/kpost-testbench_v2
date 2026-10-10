# Runbook — a complete, safe run of the whole bench

The order of operations for a full pass: prove the bench is sound, run each product against the
live application without filing, read the report, then file once. Every command is `npm run …`
from the repo root in PowerShell; the full list and what each one does is in
[`commands.md`](commands.md), and the standing rules are in `CLAUDE.md` §5–6. This file is the
sequence; it repeats neither.

---

## 0. What a run guarantees

- **Default-deny on the live application.** With `TEST_ENV=production` three controls arm and no
  configuration switches them off: the endpoint allowlist (only `productionSafe` reads run
  unguarded), the validator allowlist (nothing that mutates and re-sends is aimed at live), and the
  QA-identifier guard (no request may name a record the bench does not own).
- **Writes are gated, scoped and self-cleaning.** A write runs only inside a `*_LIFECYCLE` flow,
  only on the bench's own `qatest1..6` accounts (`QATEST_ONLY=true` on every KPost, KMail and UI
  command), and deletes or restores what it made.
- **Only valid, non-duplicate bugs are filed.** The validity gate drops infrastructure noise, the run
  gate blocks filing from a collapsed run, and a live search on the ticket tag means a re-run comments
  on an existing ticket instead of creating another.
- **Nothing is silently missed or misrouted.** The coverage ledger accounts for every documented
  endpoint and screen; component routing sends each bug to the right Bugzilla component and
  developer. Both are self-checking tests (`npm run framework`).

---

## 1. Preflight — once, and after any `.env` change

| Key                                                                | Value                                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `TEST_ENV`                                                         | `production` — arms the live-safety controls; never change it to make something run                     |
| `BASE_URL`                                                         | the live front end                                                                                      |
| `KPOST_API_BASE_URL` / `KMAIL_API_BASE_URL` / `ADMIN_API_BASE_URL` | the hosts the owner named (KPost and KMail point at the disposable test database; the Admin DB is live) |
| `BUGZILLA_URL` / `BUGZILLA_API_KEY`                                | the live instance                                                                                       |
| `BUGZILLA_DRY_RUN`                                                 | `true` — every command sets it explicitly, so this is only the fallback                                 |
| `BUGZILLA_MAX_FILE` / `BUGZILLA_MIN_SEVERITY`                      | `0` (no cap) / `MEDIUM` (LOW findings are reported, not filed)                                          |
| `QATEST1_KPOST_ID` … `QATEST6_KPOST_ID`, `QATEST_SHARED_PASSWORD`  | the bench's own accounts — the only ones KPost, KMail and UI runs log into                              |
| `QA_BUSINESS_S_*` / `QA_BUSINESS_M_*` / `QA_BUSINESS_L_*`          | the business accounts the Admin commands need (Admin is deliberately not under `QATEST_ONLY`)           |
| `WORKERS`                                                          | `1` — four concurrent logins already answer 500                                                         |

`.env.example` names every key the bench reads (a self-test fails when the code reads a key the
template does not list). Browsers are a one-time `npm run install:browsers`; `npm run accounts:verify`
proves the accounts are what the registry says.

**Before every run:**

```bash
npm run preflight
```

It proves the prerequisites instead of letting the run discover them: `.env` complete and targeting
production, no other Playwright run in progress, the hosts and Bugzilla answering and the API key
accepted, and it copies `reports/REPORT.json`/`.md` aside (every run overwrites them). It exits
non-zero on any hard failure; do not start a run until it prints READY.

---

## 2. Prove the bench before trusting it about the application

```bash
npm run check       # typecheck + lint + format — must be clean
npm run framework   # the self-tests: safety controls, coverage ledgers, routing, dedupe, payload guard
```

`framework` needs no host and files nothing. It also regenerates every file in `docs/generated/`;
commit those with the run. If the owner delivered a new workbook, regenerate the contracts first
(drop it into `docs/api-specs/`, then `contract:excel` → `contract:coverage` → `contract:gaps` →
`contract:otp`, see [`api-contracts.md`](api-contracts.md)). Do not go on while any of this is red.

---

## 3. Dry run — one product at a time, files nothing

| Product        | Command                          | Covers                                                                                                        |
| -------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| KPost API      | `npm run product:kpost-api`      | every KPost endpoint, FULL profile, write-fuzz, the self-cleaning lifecycle flows; KDoc/KOS excluded (paused) |
| KMail API      | `npm run product:kmail-api`      | every KMail endpoint, same tier, plus the compose/draft/settings lifecycle                                    |
| KPost Admin    | `npm run product:kpost-admin`    | the owner's PDF endpoints, same tier, plus the org-build lifecycle; the Admin DB stays read-only in code      |
| KPost UI       | `npm run product:kpost-ui`       | the KPost UI on Chromium, Firefox and WebKit                                                                  |
| KPost Admin UI | `npm run product:kpost-admin-ui` | the Admin/HR-Setup SPA (needs `ADMIN_UI_BASE_URL` and the BUSINESS_M account)                                 |

Run them serially. Give the server a 25–40 minute cool-down between long runs; run WebKit in small
file batches if it hangs. Concurrency and performance probes stay off (`CONCURRENCY_PROBES=false` is
already in every command): the server is shared with live users.

---

## 4. Read the report before filing anything

`reports/REPORT.md` has two parts: **Part 1** execution health (pass/fail/skip by module and
category, the top failing checks, UI results); **Part 2** the bug report (what would be filed, to
whom, and every finding that was rejected with its reason). `reports/REPORT.json` is the same,
structured.

Before a `:file` run, for every candidate in Part 2:

1. **Read the real response** it is built from. A fixture or environment fault is not a product bug
   (a 401 streak confined to one endpoint is a bench auth blip; a 429 or gateway 5xx is "not
   re-checked", never "still broken").
2. **Reproduce it alone** when it came from a batch (`--grep "\[endpoint-id\]"`; lifecycle and
   business-rule findings need their `*_LIFECYCLE` flag instead).
3. **Check for an existing ticket by hand** when the fingerprint is new
   (`npm run bugzilla:dupe-check`), including the platform-wide components.

---

## 5. File — once per product, after the dry run is understood

| Product     | Command                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| KPost API   | `npm run product:kpost-api:file`                                                                              |
| KMail API   | `npm run product:kmail-api:file`                                                                              |
| KPost Admin | `npm run product:kpost-admin:file`                                                                            |
| KPost UI    | `npm run ui:chromium:file` · `ui:firefox:file` · `ui:webkit:file` (one browser per run), then `ui:admin:file` |

A `:file` run files the valid, non-duplicate candidates, reopens a bug whose fault is back, closes a
bug whose own check passed cleanly, and puts a dated plain-English note on every other open bug of
that product. Filing cannot be undone. Run it one product at a time, never two bench runs at once.

---

## 6. Status pass only — re-check open bugs, file nothing new

`npm run kpost:full:verify` runs the full KPost sweep in resolve-only mode: closes verified fixes,
dates every other open bug. Use it after a developer deploy, once the owner has said "deploy done".
A bug is closed only on a live replay of its original request; a "fixed" claim alone never closes
anything.

---

## 7. What a run cannot reach, and why

| Class                                                 | On live?                  | Why                                                                                           |
| ----------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------- |
| Reads: status, schema, headers, sensitive data, auth  | yes                       |                                                                                               |
| Input validation on reads                             | yes                       | a read persists nothing; the identifier guard confines it                                     |
| Write lifecycles (create → act → delete)              | yes, gated                | `*_LIFECYCLE`, on the qatest accounts, self-cleaning                                          |
| Write-fuzz and attack probes                          | yes, on the test DB       | `WRITE_FUZZ` + `TEST_DB_MODE`; they persist junk, so test DB only                             |
| OTP flows: signup, device changes, forgot-password    | only via the test gateway | `OTP_TEST_GATEWAY` on the genuine test gateway; the SMS/OTP kill-switch is otherwise absolute |
| `external` / `global` writes (real SMS, app version…) | never                     | no flag unlocks them                                                                          |
| KDoc/KOS, performance, concurrency                    | paused                    | owner directives; wired into the commands, not just remembered                                |

The per-endpoint answer is [`../generated/live-endpoints.md`](../generated/live-endpoints.md); the
reasons are in [`../scope/blocked-endpoints-rationale.md`](../scope/blocked-endpoints-rationale.md).

---

## 8. After the run

- Commit the regenerated `docs/generated/` files with any source change the run prompted.
- Run logs and ad-hoc output go to a temp folder, never the repo; traces contain tokens.
- If a flow changed, add a dated entry at the top of
  [`../reference/decision-log.md`](../reference/decision-log.md).
