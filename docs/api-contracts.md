# API contracts — the Excel workbook is the source of truth

The KPost API **Excel workbook** is the authoritative contract for this bench. The swagger/OpenAPI
files that used to live here were removed: they disagreed with the workbook, and testing against a
wrong contract produces tickets that blame the API for the document.

Everything in `contracts/` and `openapi/` is **generated**. Nothing in them is hand-edited.

## Commands

```bash
npm run contract:excel      # convert the workbook → contracts + OpenAPI
npm run contract:coverage   # prove every workbook endpoint reached the contracts (gate)
npm run contract:gaps       # list what the workbook is still missing, for filling in

npm run contract:excel -- "C:/path/KPOST API (6).xlsx"   # any workbook
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

A row reaches the OpenAPI document **only** when it has a real path, a **known HTTP method**, is not
superseded and is not a duplicate. Everything else stays in the `.contract.json` marked
`usable: false` with its reasons, so the gap stays visible instead of being guessed at.

| Exclusion                                      | Meaning                                                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `method-unknown`                               | No Method column and no method stated in the row. **Never inferred** — a wrong verb produces failing tests that blame the API for the spreadsheet |
| `superseded`                                   | Yellow (`#FFFF00`) fill = retired endpoint                                                                                                        |
| `duplicate`                                    | Same method+path already taken from a more complete row (the one with request _and_ response wins)                                                |
| `legacy-v1`                                    | A `devapi1`/non-`/v2` row whose `/v2` twin exists                                                                                                 |
| `request-unparseable` / `response-unparseable` | The cell mixes prose into the JSON (`"type": 1- Daily, 2 - Weekly`), so no schema is inferred — the raw text is still kept                        |

### Current numbers (`KPOST API (5).xlsx`)

| Product     | Rows | Usable → OpenAPI | With request example | With response example |
| ----------- | ---- | ---------------- | -------------------- | --------------------- |
| `kpost-api` | 307  | **77**           | 6                    | 24                    |
| `kmail-api` | 76   | **68**           | 40                   | 27                    |

Excluded: 238 rows — 224 `method-unknown`, 24 `superseded`, 20 `request-unparseable`, 4 `duplicate`,
4 `legacy-v1`, 1 `response-unparseable`. Zero duplicate paths or operationIds survive into the
generated documents.

**The method gap dominates.** The KatchupAPI tab has no Method column, so 224 rows — including most
of the documented request payloads — cannot yet become callable endpoints. Adding that one column
converts them automatically on the next run.

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
