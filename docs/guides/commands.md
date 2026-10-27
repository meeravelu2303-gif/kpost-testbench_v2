# Commands

Run from the repo root in PowerShell. Every product has two commands:

- **Preview:** runs every test and writes `reports/REPORT.md`. Files nothing.
- **File:** the same run, then files the valid new bugs to Bugzilla, reopens fixed bugs that came back,
  closes the bugs it verified fixed, and adds a dated note to every other open bug of that product.

Run the preview, read the plan with `npm run report:filing`, then run the file command. Never start a
run while another one is in progress.

## KPost API

```powershell
npm run product:kpost-api
npm run product:kpost-api:file
npm run product:kpost-api:verify      # re-check open bugs only: closes fixed ones, files nothing new
```

## KMail API

```powershell
npm run product:kmail-api
npm run product:kmail-api:file
```

## KPost Admin API

```powershell
npm run product:kpost-admin
npm run product:kpost-admin:file
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

## KPost Admin UI

```powershell
npm run product:kpost-admin-ui
npm run product:kpost-admin-ui:file
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

## Quick health checks (file nothing)

```powershell
npm run test:smoke           # also test:smoke:api, test:smoke:ui
npm run test:sanity
npm run test:regression      # also test:regression:api, test:regression:ui
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
