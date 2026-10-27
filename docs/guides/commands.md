# Commands

Run from the repo root in PowerShell. Every product has its own commands, so a product can be checked
right after its own deploy without re-testing the others.

**The routine: run the tests once, then file.**

```powershell
npm run product:kpost-api      # 1. run every test (files nothing; saves what it found)
npm run report:filing          # 2. read the plan: create / reopen / comment / close / needs review
npm run bug:apply              # 3. file that plan to Bugzilla, without running the tests again
```

`bug:apply` uses the same filing step as a `:file` run, with the same strict gates: the validity gate,
a live duplicate search in Bugzilla for every finding, never refiling a bug closed INVALID / WONTFIX /
DUPLICATE, reopening a fixed bug that came back, and holding uncertain findings for review. It
refuses a plan that is more than 24 hours old, came from a run that failed the run gate, or was
already applied once. Status comments carry the date the tests ran.

The `:file` commands below are the one-step alternative: they run the tests and file in the same run.
Never start a run while another one is in progress.

## KPost API

```powershell
npm run product:kpost-api
npm run product:kpost-api:file
npm run product:kpost-api:verify      # re-check open bugs only: closes fixed ones, files nothing new
```

Quick checks after a deploy (file nothing; checks the KPost API only):

```powershell
npm run test:smoke:kpost-api
npm run test:sanity:kpost-api      # add -- --module <name> or -- --bug <id> to narrow it
npm run test:regression:kpost-api
```

## KMail API

```powershell
npm run product:kmail-api
npm run product:kmail-api:file
```

Quick checks after a deploy (file nothing; checks the KPost login first, since KMail uses its token):

```powershell
npm run test:smoke:kmail-api
npm run test:sanity:kmail-api      # add -- --module <name> or -- --bug <id> to narrow it
npm run test:regression:kmail-api
```

## KPost Admin API

```powershell
npm run product:kpost-admin
npm run product:kpost-admin:file
```

Quick checks after a deploy (file nothing; checks the KPost login first; Admin has no regression set, so regression is its smoke):

```powershell
npm run test:smoke:kpost-admin
npm run test:sanity:kpost-admin      # add -- --module <name> or -- --bug <id> to narrow it
npm run test:regression:kpost-admin
```

## KPost UI

```powershell
npm run product:kpost-ui              # Chromium, Firefox and WebKit in one run
npm run product:kpost-ui:file

npm run product:kpost-ui:chromium:file    # one browser per run (preferred: 25-40 min cool-down between)
npm run product:kpost-ui:firefox:file
npm run product:kpost-ui:webkit:file
```

Each browser also has a preview: `product:kpost-ui:chromium`, `:firefox`, `:webkit`.

Special checks (preview only):

```powershell
npm run product:kpost-ui:visual           # screenshot comparison (product:kpost-ui:visual:update refreshes the baselines)
npm run product:kpost-ui:monitor          # the hosts and pages answer
npm run product:kpost-ui:perf             # page load times, one user
npm run product:kpost-ui:session-check    # a logged-out session is really ended
```

Quick checks after a deploy (file nothing; checks the KPost API and KMail API smoke first, since the UI is built on both):

```powershell
npm run test:smoke:kpost-ui
npm run test:sanity:kpost-ui      # add -- --module <name> or -- --bug <id> to narrow it
npm run test:regression:kpost-ui
```

## KPost Admin UI

```powershell
npm run product:kpost-admin-ui
npm run product:kpost-admin-ui:file
```

Quick checks after a deploy (file nothing; checks the KPost login and the Admin API smoke first):

```powershell
npm run test:smoke:kpost-admin-ui
npm run test:sanity:kpost-admin-ui      # add -- --module <name> or -- --bug <id> to narrow it
npm run test:regression:kpost-admin-ui
```

## All products

```powershell
npm run product:all          # the five previews, one after another
npm run product:all:file     # the five file runs, one after another
```

Each product runs even if the one before it found failures.

---

## Before a run

```powershell
npm run preflight            # .env complete, hosts and Bugzilla answer, no other run in progress
npm run check                # typecheck + lint + format
npm run framework            # the bench's self-tests (safety guards, filing gates)
```

## After a run

```powershell
npm run report:filing        # the filing plan in plain English: create / reopen / comment / close / needs review
npm run bug:apply            # file the last preview's plan (once, within 24 h)
npm run bug:file-reviewed    # file the NEEDS YOUR REVIEW items you approved
npm run report               # open the Playwright HTML report
```

Results: `reports/REPORT.md` (and `REPORT.json`). The previous ten runs are in `reports/history/`.

## Filing a bug by hand

```powershell
npm run bug:dupe-check       # always first
npm run bug:preview
npm run bug:file
npm run bug:file-approved -- <KP-id>   # file one finding from the last preview, by its id (add --live)
```

## Quick checks for every product at once (file nothing)

```powershell
npm run test:smoke           # every product in order, one verdict each
npm run test:sanity
npm run test:regression
```

## After a new API workbook or Admin deploy

```powershell
npm run contract:excel       # rebuild contracts/ and openapi/ from docs/api-specs/KPOST API (N).xlsx
npm run contract:coverage    # prove no workbook endpoint was lost
npm run contract:admin       # refresh the Admin contract from the live Admin server + the PDF payloads
```

## One-time setup

```powershell
npm install
npm run install:browsers
npm run accounts:verify      # the QA accounts exist and match .env
```

Developer tools: `npm run lint:fix`, `format`, `lint:tags`, `codegen`, `accounts:provision`,
`contract:admin:pdf`.

Safety rules that hold on every command (test hosts only, no real SMS/OTP, no request naming a record
outside the QA accounts, the Admin database read-only, KDoc/KOS and concurrency excluded) are in
`CLAUDE.md` §1 and §5.
