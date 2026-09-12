# API contracts — the Excel workbook is the source of truth

The KPost API **Excel workbook** is the authoritative contract for this bench. The swagger/OpenAPI
files that used to live here were removed: they disagreed with the workbook, and testing against a
wrong contract produces tickets that blame the API for the document.

Everything in `contracts/` and `openapi/` is **generated**. Nothing in them is hand-edited.

## Commands

```bash
npm run contract:excel      # convert the newest "KPOST API (N).xlsx" in the repo root
npm run contract:coverage   # prove every workbook endpoint reached the contracts (gate)
npm run contract:gaps       # list what the workbook is still missing, for filling in

npm run contract:excel -- "C:/path/KPOST API (7).xlsx"   # or a specific workbook
```

Run all three after every new dump, and commit the results: the diff shows exactly which endpoint
or field changed — the review a binary spreadsheet cannot give you.

## What is generated

```
scripts/excel-to-contract.cjs   the converter
scripts/contract-coverage.cjs   the independent coverage audit
scripts/excel-gap-report.cjs    the "what to fill in" report
        │
        ├── contracts/kpost-api.contract.json   every KPost row, usable or not, with reasons
        ├── contracts/kmail-api.contract.json   every KMail row, same shape
        ├── contracts/kpost-types.json          the Types tab (13 enum groups)
        ├── contracts/_conversion-report.json   every excluded row and why
        ├── contracts/_coverage.json            audit result: anything in the workbook we missed
        ├── contracts/excel-gaps.csv            one row per gap, opens in Excel
        ├── contracts/excel-gaps.md             the same, summarised
        ├── openapi/kpost-api.openapi.json      ONLY the usable KPost rows
        └── openapi/kmail-api.openapi.json      ONLY the usable KMail rows
```

KPost and KMail are separate products maintained by different developers, so they get separate
documents — never one merged file.

### Which tabs feed which product

| Product     | Tabs                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| `kpost-api` | KatchupAPI (katchup, kall, knews, kword, redbus, common, admin-facing rows), KDIARY, V2 TESTED APIS, Sheet3 |
| `kmail-api` | KMAILAPI                                                                                                    |

Kall and KDiary are part of the KPost API, exactly as in the workbook — the "Kool Kall" tab is empty
in v5 and its endpoints live in the KatchupAPI tab. Types and Sheet8 are reference tables, not
endpoints.

## Nothing invalid or duplicated is converted

A row reaches the OpenAPI document **only** when it has a real path and a method, is not superseded
and is not a duplicate. Everything else stays in the `.contract.json` marked `usable: false` with
its reasons, so the gap stays visible instead of being quietly dropped.

| Exclusion                                      | Meaning                                                                                                                                                   |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `superseded`                                   | Yellow (`#FFFF00`) fill = retired endpoint                                                                                                                |
| `duplicate`                                    | Same method+path already taken from a more complete row (the one with request _and_ response wins)                                                        |
| `legacy-v1`                                    | A `devapi1`/non-`/v2` row whose `/v2` twin exists                                                                                                         |
| `method-unknown`                               | Neither the workbook nor the payload rule can settle the method. **Nothing currently hits this** — kept as the honest exit                                |
| `request-unparseable` / `response-unparseable` | The cell mixes prose into the JSON (`"type": 1- Daily, 2 - Weekly`), so no schema is inferred — the raw text is still kept, and the endpoint stays usable |

### Current numbers (`KPOST API (6).xlsx`)

| Product     | Rows | Usable → OpenAPI | With request schema | With response schema |
| ----------- | ---- | ---------------- | ------------------- | -------------------- |
| `kpost-api` | 306  | **266**          | 165                 | 119                  |
| `kmail-api` | 76   | **71**           | 44                  | 26                   |

Excluded: 45 rows — 24 `superseded` (yellow), 24 `duplicate`, 4 `legacy-v1`, 2 `unused-note`
(a request cell that says `UNUSED` or `Not needed API changed in V2`); some rows carry more than one
reason. **Nothing is excluded for a missing method.** Zero duplicate paths or operationIds survive
into the generated documents.

**Methods come from four places, in order — the first that applies wins.**

1. **The request cell states a method and the payload agrees** — `GET METHOD` with no payload
   documented. This wins **even over a Method column**, because on KMail the column predates tokens
   while the `After Token Implemented` cell describes today's contract. 7 KMail rows resolve this
   way (`C16 C17 C18 C23 C25 C26 C58`).
2. **A Method column** (KDIARY, V2 TESTED APIS, KMAILAPI).
3. **A stated method the payload contradicts** — used, but flagged for confirmation.
4. **The owner's payload rule:** a documented request payload means POST, no payload means GET.

**Only POST and GET exist in this API.** Confirmed by the owner, and corroborated before it was
applied: of the 95 workbook rows that state a method, 80 say POST and 15 say GET — PUT, PATCH and
DELETE appear nowhere, in no Method column and in no request note. An `updateX` or `deleteX`
endpoint with a payload is therefore a POST. The derivation is limited to POST and GET; a workbook
that later _states_ another verb is still honoured.

| `methodSource`  | Count | Where it comes from                                                          |
| --------------- | ----: | ---------------------------------------------------------------------------- |
| `method-column` |    71 | a Method column on the tab                                                   |
| `request-note`  |    76 | the request cell says so, and it outranks the column when the payload agrees |
| `payload-rule`  |   190 | derived from the presence of a payload                                       |

Provenance travels with every endpoint — `methodSource`, `methodOverrode` (what was displaced) and
`methodDoubts` (still ambiguous) — and reaches the OpenAPI documents as `x-method-source`,
`x-method-note` and `x-method-doubts`, so a derived method is never mistaken for a documented one.
**Nothing currently carries a doubt.**

### Yellow rows are unused, and are not added

A yellow (`#FFFF00`) row is a retired endpoint: the owner's instruction is that these are not added,
so they are excluded and no longer listed as something to confirm. A request cell that says the same
in words (`UNUSED`, `Not needed API changed in V2`) retires its row too. They stay in the contract
files as `usable: false`, so the decision is auditable rather than invisible.

They are also **excluded from winning deduplication**. They used to: scoring ranked duplicates by
completeness with an earliest-row tie-break, and a yellow row frequently beat the live row
documenting the same path. The live row was then marked `duplicate-of <retired row>` and both were
dropped — the endpoint disappeared from the contracts, invisibly, because the coverage audit sees
both rows as contract records either way. Seven endpoints were affected: `/v2/kall/initiateKall`,
`/v2/kall/getKallStatus`, `/v2/kall/clearKallBykallIds`, `/v2/kall/frequentKallContacts`,
`/v2/kall/clearKallHistory`, `/v2/kall/todayKoolKall` and `/common/postBoxContacts`.

### The workbook's vocabulary

These cells are statements about the contract, not payloads, and reading them literally is what
makes the method derivable:

| Cell text                                   | Rows | Meaning                              |
| ------------------------------------------- | ---: | ------------------------------------ |
| `GET METHOD`                                |   79 | no request body                      |
| `Not Required` / `NOT REQUIRED`             |    5 | no request body                      |
| `multipart key : file`, `file (multipart…)` |    4 | a body, but a file upload not JSON   |
| `UNUSED`, `Not needed API changed in V2`    |    2 | the row is stale — flagged, not used |

**KMail's two request columns are two eras.** E is `Parameters / Request`; F is
`After Token Implemented Parameters/Request`. F describes today's contract and wins — and F often
says `GET METHOD` where E still shows a `{kpostUser}` body, because the user now comes from the JWT.
Reporting those as "missing payload" was wrong: there is nothing to fill in.

### Rows that document two endpoints

Four rows hold two URLs. Their payloads pair positionally when there are two; when there is **one
payload for two URLs it is shared** and flagged, because discarding it (the previous behaviour)
reported both endpoints as having no payload at all.

`KatchupAPI R88` is different: it reads `endKall url changed to endKoolKall` — one endpoint that
moved. The last URL is taken as current and the old one is recorded as `replacedUrl`, which the
coverage audit then recognises by name instead of waving it through as a stray mention.

### Overriding a derived method

The derived methods are correct unless the workbook says otherwise, so a Method column is now an
**override**, not a prerequisite. The converter finds it **by its header**, not by a column letter,
so adding one to a tab that has none is picked up on the next run with no code change:

| Tab            | Method column | Status                                      |
| -------------- | ------------- | ------------------------------------------- |
| KatchupAPI     | **Q**         | none — add one here to override 192 derived |
| Sheet3         | **H**         | none — add one here to override 15 derived  |
| KDIARY         | C             | present                                     |
| V2 TESTED APIS | B             | present                                     |
| KMAILAPI       | C             | present                                     |

**Append the column after the last used one; never insert it.** The other columns are addressed by
letter, so inserting shifts them all. That mistake is caught rather than absorbed: every tab
declares the headers it expects (`expect` in `TABS`), and a header that no longer matches stops the
run with `layout changed on tab "<name>" — refusing to convert`, naming the column that moved. The
alternative — reading the wrong cells and producing a plausible-looking contract — is far worse than
a failed run.

`contracts/excel-gaps.csv` carries a **FillCell** column naming the exact destination cell for every
row that needs a method decision (`KatchupAPI!Q7`), taken from the same conversion report, so the
list and the converter can never disagree about where the method belongs.

## Coverage — proving nothing was dropped

`npm run contract:coverage` re-parses the workbook **independently of the converter** and scans
every cell of every endpoint tab for a URL, not just the columns the converter reads. An audit that
reused the converter's column map would only ever agree with itself.

It earned its place immediately: three endpoints were being dropped silently because their endpoint
column held junk while the real URL sat in the notes column —

| Row            | Endpoint column | Real URL                                   |
| -------------- | --------------- | ------------------------------------------ |
| KatchupAPI R66 | `z`             | `/v2/profile/updateProfileImage/`          |
| KatchupAPI R95 | _(empty)_       | `/v2/kall/endIndividualKall/`              |
| KatchupAPI R99 | a JSON payload  | `/v2/katchup/sendBulkKatchupMsgMultiPart/` |

The converter now falls back to any URL in the row when its endpoint column is junk — but only when
the row documents something real (a method or a parseable example), so a tab header like KMAILAPI R1
(`https://kmail5.kpostindia.com/kmail5/v2/`) is not mistaken for an endpoint.

**Current status: 0 uncovered.** Every endpoint URL in the workbook is present in the contracts.
URLs quoted in notes columns (old v1 names, review comments, a Google Docs link) are reported
separately as `mentionsOnly`, never as gaps.

## What the generated OpenAPI does and does not claim

- **Schemas are inferred from the documented examples.** Types come from the sample values and the
  sample is kept as `example`. No property is marked `required`: an example cannot prove a field is
  mandatory, and inventing that would make the bench reject valid requests.
- **No status codes.** The workbook documents none, so every operation declares a single `200` and
  the bench falls back to its own per-method defaults.
- **No auth.** The workbook does not say which endpoints are public, so `bearerAuth` is declared but
  applied to nothing.
- **`x-excel-source`** on every operation points back to the exact tab and row.

## The Types tab — and where the types live in the bench

`contracts/kpost-types.json` holds 13 enum groups: `katchupStatus`, `katchupMessageType`,
`katchupShareType`, `kallStatus`, `kallType`, `kallMode`, `kallRepeatType`, `kmailType`,
`kmailReceiverType`, `kmailPriority`, `kdiaryRemarks`, `module` (0–17) and `userType`.

These numbers are part of the contract — a payload sends `kmailType: 11` and means "share". So they
are **not** retyped into test data. [`src/api/schemas/kpost-types.ts`](../src/api/schemas/kpost-types.ts)
is the typed way to read the generated file:

```ts
import { KMAIL_TYPE, KMAIL_RECEIVER_TYPE, labelFor, codeFor } from '@api/schemas/kpost-types';

KMAIL_TYPE.share; // 11
KMAIL_RECEIVER_TYPE.receiverTypeTo; // 1
labelFor('kallStatus', 6); // 'Scheduled'
codeFor('kmailType', 'Share'); // 11
```

Named maps exist for every group payloads reference (`KATCHUP_MESSAGE_TYPE`, `KALL_STATUS`,
`KALL_MODE`, `KMAIL_PRIORITY`, `KDIARY_REMARKS`, `KPOST_MODULE`, …), plus `USER_TYPES` for the
business tiers — the one group the workbook gives as labels only, with no numeric codes.

[`tests/framework/types-contract.spec.ts`](../tests/framework/types-contract.spec.ts) pins the
groups and the load-bearing values, so a workbook edit that renames or renumbers something fails a
test instead of silently changing what the bench sends.

## How contracts become tests

Generated specs are **not** tests. `src/api/definitions/` decides which endpoints the bench actually
calls: a definition names the module (which sets the host, the Bugzilla product and the owning
developer) and adds what a spec cannot express — a request factory, business rules, DB checks. See
[validation-framework.md](validation-framework.md).

Today KMail loads read-only GET operations from its generated spec; the KPost core endpoints are
hand-written against the mock until the method gap closes. The Admin module has **no contract at
all** — it is absent from the workbook — so it has no endpoints yet.
