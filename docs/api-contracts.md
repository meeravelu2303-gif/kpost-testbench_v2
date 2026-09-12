# API contracts — the Excel workbook is the source of truth

The KPost API **Excel workbook** is the authoritative contract for this bench. The swagger/OpenAPI
files that used to live here were removed: they disagreed with the workbook, and testing against a
wrong contract produces tickets that blame the API for the document.

Everything in `contracts/` and `openapi/` is **generated** from the workbook by one script. Nothing
in them is hand-edited.

## What is generated

```
scripts/excel-to-contract.cjs   the converter (run it, never edit the outputs)
        │
        ├── contracts/kpost-api.contract.json   every KPost row, usable or not, with reasons
        ├── contracts/kmail-api.contract.json   every KMail row, same shape
        ├── contracts/kpost-types.json          the Types tab (13 enum groups)
        ├── contracts/_conversion-report.json   every excluded row and why
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

Kall and KDiary are part of the KPost API, exactly as in the workbook — the "Kool Kall" tab is
empty in v5 and its endpoints live in the KatchupAPI tab.

## Regenerating

```bash
npm run contract:excel                                  # uses the newest known workbook path
npm run contract:excel -- "C:/path/KPOST API (6).xlsx"  # or an explicit one
```

Commit the regenerated files: the diff shows exactly which endpoint or field changed, which is the
review a binary spreadsheet cannot give you.

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
| `kpost-api` | 304  | **77**           | 6                    | 24                    |
| `kmail-api` | 76   | **68**           | 40                   | 27                    |

Excluded: 235 rows — 221 `method-unknown`, 24 `superseded`, 20 `request-unparseable`, 4 `duplicate`,
4 `legacy-v1`, 1 `response-unparseable`.

**The method gap dominates.** The KatchupAPI tab has no Method column, so 221 rows — including most
of the documented request payloads — cannot yet become callable endpoints. Adding that one column
to the workbook converts them automatically on the next run.

## What the generated OpenAPI does and does not claim

- **Schemas are inferred from the documented examples.** Types come from the sample values and the
  sample is kept as `example`. No property is marked `required`: an example cannot prove a field is
  mandatory, and inventing that would make the bench reject valid requests.
- **No status codes.** The workbook documents none, so every operation declares a single `200` and
  the bench falls back to its own per-method defaults.
- **No auth.** The workbook does not say which endpoints are public, so `bearerAuth` is declared but
  applied to nothing. Endpoint definitions set this explicitly where it is known.
- **`x-excel-source`** on every operation points back to the exact tab and row, so any generated
  line can be traced to the cell it came from.

## The Types tab

`contracts/kpost-types.json` holds 13 enum groups: `katchupStatus`, `katchupMessageType`,
`katchupShareType`, `kallStatus`, `kallType`, `kallMode`, `kallRepeatType`, `kmailType`,
`kmailReceiverType`, `kmailPriority`, `kdiaryRemarks`, `module` (0–17) and `userType`
(`BUSINESS_S/M/L`).

These are the numeric codes the payloads use. `userType` is the one group the workbook gives as
labels only — no numeric codes.

## How contracts become tests

Generated specs are **not** tests. `src/api/definitions/` decides which endpoints the bench
actually calls: a definition names the module (which sets the host, the Bugzilla product and the
owning developer), and adds what a spec cannot express — a request factory, business rules, DB
checks. See [validation-framework.md](validation-framework.md).

Today KMail loads read-only GET operations from its generated spec; the KPost core endpoints are
hand-written against the mock until the method gap closes. The Admin module has **no contract at
all** — it is absent from the workbook — so it has no endpoints yet.
