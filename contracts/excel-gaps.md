# Excel gaps — what to confirm or fill in the workbook

Generated from the parsed contracts. 233 rows need attention; open
`contracts/excel-gaps.csv` in Excel for the full list — it has **Tab**, **Row** and **FillCell**,
so every line names the cell it is talking about.

## How the HTTP method is decided now

Methods are no longer blocked on the workbook. The rule given by the API owner is applied:

> **A documented request payload means POST. No payload means GET.**

This API uses **only POST and GET** — no PUT, PATCH or DELETE (the workbook states a method 95
times: 80 POST, 15 GET). So an `updateX` or `deleteX` endpoint with a payload is a POST, and the
rule needs no confirming.

The workbook still wins wherever it states a method — a Method column, or a `GET METHOD` note in
the request cell — and the **MethodFrom** column records which applied:

| MethodFrom | Meaning |
| --- | --- |
| `method-column` | the tab has a Method column and it was used |
| `request-note` | the request cell says so in words (`GET METHOD`, `Not Required(Get method)`) |
| `payload-rule` | derived from the presence of a payload, per the rule above |

Typing a method into the **FillCell** cell overrides the derived one on the next run.

**Yellow rows are unused and are not added** — 25 of them, excluded and not listed
below. They stay in `*.contract.json` marked `usable: false` so the decision is auditable.

| Priority | Meaning | Rows |
| --- | --- | ---: |
| P1 | **Confirm the HTTP method** — the workbook contradicts itself | 0 |
| P2 | Request payload and/or sample response missing | 185 |
| P3 | The JSON sample does not parse, so no schema is inferred | 27 |
| P4 | Duplicate, legacy, or two endpoints in one row | 21 |

## Resolved without you: 7 rows where the request cell won

These are **not** gaps. The Method column disagreed with the request cell, and the cell
agreed with the payload, so the cell was used — the column predates tokens, the cell
describes today's contract:

| Cell | Endpoint | Method used | Column said |
| --- | --- | --- | --- |
| `KMAILAPI!C16` | `/common/frequentKmailContact/` | **GET** | POST |
| `KMAILAPI!C17` | `/common/unOpenedMailCountBySenderID/` | **GET** | POST |
| `KMAILAPI!C18` | `/common/miscellaneousContacts/` | **GET** | POST |
| `KMAILAPI!C23` | `/sentMail/loadOtherDomainMails/` | **GET** | POST |
| `KMAILAPI!C25` | `/draft/getAllDraftMails/` | **GET** | POST |
| `KMAILAPI!C26` | `/draft/getDraftMailsContacts/` | **GET** | POST |
| `KMAILAPI!C58` | `/readMail/download/{uuid}` | **GET** | POST |

## P1 — nothing to confirm

Every method is either stated by the workbook or settled
by the payload rule.


### Where to type a correction

Only needed where the derived method is wrong. Per tab:

| Tab | P1 rows | Method column | Status |
| --- | ---: | --- | --- |
| KatchupAPI | 0 | **Q** | none — a column headed `Method` in Q would override the derived methods |
| KDIARY | 0 | **C** | already there |
| V2 TESTED APIS | 0 | **B** | already there |
| Sheet3 | 0 | **H** | none — a column headed `Method` in H would override the derived methods |
| KMAILAPI | 0 | **C** | already there |
| API Services | 0 | **A** | already there |

> **If you add that column (KatchupAPI → Q, Sheet3 → H), append it at the end — never insert it.**
> The converter finds the Method column by its header, so appending it needs no code change.
> Inserting one shifts every column letter after it — the converter then stops with a
> "layout changed" error instead of reading the wrong cells.

## First 15 rows of each priority

### P2 (185 rows)

| Tab:Row | Path | Method | From | Request / Response | Action |
| --- | --- | --- | --- | --- | --- |
| KMAILAPI:R19 | `/common/convertMailAsPDF/` | POST | method-column | no payload / no | Add the request payload (the method column says POST) and a sample response. |
| KMAILAPI:R30 | `/readMail/referenceMailContent/` | POST | method-column | payload / no | Add a sample response. |
| KMAILAPI:R37 | `/common/postBoxContacts/` | POST | method-column | payload / no | Add a sample response. |
| KMAILAPI:R38 | `/kmailSetting/getDigitalSignature` | GET | request-note | no payload / no | Add a sample response. |
| KMAILAPI:R39 | `/common/deleteOtherDomainContact/` | POST | method-column | payload / no | Add a sample response. |
| KMAILAPI:R40 | `/common/editOtherDomainContactsDetails/` | POST | method-column | payload / no | Add a sample response. |
| KMAILAPI:R41 | `/common/knownPostBoxContacts/` | POST | method-column | payload / no | Add a sample response. |
| KMAILAPI:R42 | `/common/statusOfKmailsContactsTotalCount/` | GET | request-note | no payload / no | Add a sample response. |
| KMAILAPI:R45 | `/v2/sentMail/postMail/` | POST | method-column | payload / no | Add a sample response. |
| KMAILAPI:R46 | `/readMail/getCopiesInfo/{kmailID}` | GET | method-column | no payload / no | Add a sample response. |
| KMAILAPI:R47 | `/v2/aws/generate-presigned-url` | POST | method-column | payload / no | Add a sample response. |
| KMAILAPI:R48 | `/v2/readMail/downloadODAttachment` | POST | method-column | payload / no | Add a sample response. |
| KMAILAPI:R49 | `/readMail/downloadThumbnail/{uuid}` | GET | request-note | no payload / no | Add a sample response. |
| KMAILAPI:R50 | `/readMail/mediaStreaming/{uuid}` | GET | request-note | no payload / no | Add a sample response. |
| KMAILAPI:R51 | `/kmailSetting/deleteCustomizedInstantReply` | POST | method-column | payload / no | Add a sample response. |

### P3 (27 rows)

| Tab:Row | Path | Method | From | Request / Response | Action |
| --- | --- | --- | --- | --- | --- |
| KMAILAPI:R15 | `/common/getAllImportantMails/` | POST | method-column | payload / text only | Fix the response sample — it is not valid JSON (prose or `0 or 1 or 2` style alternatives mixed in), so no schema can be inferred. |
| KMAILAPI:R20 | `/common/selectedContactMails/` | POST | method-column | payload (sample broken) / no | Fix the request sample — it is not valid JSON (prose or `0 or 1 or 2` style alternatives mixed in), so no schema can be inferred. |
| KMAILAPI:R24 | `/draft/draftMail/` | POST | method-column | payload (sample broken) / yes | Fix the request sample — it is not valid JSON (prose or `0 or 1 or 2` style alternatives mixed in), so no schema can be inferred. |
| KMAILAPI:R31 | `/readMail/sentAndInboxMailContent/` | POST | method-column | payload (sample broken) / yes | Fix the request sample — it is not valid JSON (prose or `0 or 1 or 2` style alternatives mixed in), so no schema can be inferred. |
| KMAILAPI:R43 | `/common/clearStatusOfKmailsContacts/` | POST | method-column | payload (sample broken) / no | Fix the request sample — it is not valid JSON (prose or `0 or 1 or 2` style alternatives mixed in), so no schema can be inferred. |
| KMAILAPI:R44 | `/draft/draftMailMultiPart` | POST | method-column | payload (sample broken) / no | Fix the request sample — it is not valid JSON (prose or `0 or 1 or 2` style alternatives mixed in), so no schema can be inferred. |
| KMAILAPI:R54 | `/common/clearStatusOfAllKmailsContacts` | POST | method-column | payload (sample broken) / no | Fix the request sample — it is not valid JSON (prose or `0 or 1 or 2` style alternatives mixed in), so no schema can be inferred. |
| KatchupAPI:R4 | `/v2/signupLogin/userLogin/` | POST | payload-rule | payload (sample broken) / yes | Fix the request sample — it is not valid JSON (prose or `0 or 1 or 2` style alternatives mixed in), so no schema can be inferred. |
| KatchupAPI:R17 | `/v2/signupLogin/signup/` | POST | payload-rule | payload (sample broken) / yes | Fix the request sample — it is not valid JSON (prose or `0 or 1 or 2` style alternatives mixed in), so no schema can be inferred. |
| KatchupAPI:R37 | `/v2/katchup/sendMessage/` | POST | payload-rule | payload (sample broken) / yes | Fix the request sample — it is not valid JSON (prose or `0 or 1 or 2` style alternatives mixed in), so no schema can be inferred. |
| KatchupAPI:R44 | `/v2/katchup/deleteKatchUpMessage/` | POST | payload-rule | payload (sample broken) / yes | Fix the request sample — it is not valid JSON (prose or `0 or 1 or 2` style alternatives mixed in), so no schema can be inferred. |
| KatchupAPI:R70 | `/v2/katchup/downloadThumbnail/{uuid}` | GET | request-note | no payload / text only | Fix the response sample — it is not valid JSON (prose or `0 or 1 or 2` style alternatives mixed in), so no schema can be inferred. |
| KatchupAPI:R73 | `/v2/contacts/blockOrUnBlockContact/` | POST | payload-rule | payload (sample broken) / no | Fix the request sample — it is not valid JSON (prose or `0 or 1 or 2` style alternatives mixed in), so no schema can be inferred. |
| KatchupAPI:R96 | `/v2/kall/contactInfo/` | POST | payload-rule | payload (sample broken) / yes | Fix the request sample — it is not valid JSON (prose or `0 or 1 or 2` style alternatives mixed in), so no schema can be inferred. |
| KatchupAPI:R118 | `/v2/katchup/forwardKatchupMessage/` | POST | payload-rule | payload / text only | Fix the response sample — it is not valid JSON (prose or `0 or 1 or 2` style alternatives mixed in), so no schema can be inferred. |

### P4 (21 rows)

| Tab:Row | Path | Method | From | Request / Response | Action |
| --- | --- | --- | --- | --- | --- |
| KatchupAPI:R3 | `/v2/profile/fetchUserDetails/` | POST | payload-rule | payload / yes | Confirm which row is current (duplicate-of KatchupAPI:R2). |
| KatchupAPI:R3 | `/v2/signupLogin/fetchUserDetails/` | POST | payload-rule | payload / yes | one payload is documented for the two endpoints in this row — split the row so each endpoint has its own payload. |
| KatchupAPI:R6 | `/v2/common/msStatus/` | GET | payload-rule | no payload / text only | Confirm which row is current (duplicate-of V2 TESTED APIS:R6). |
| KatchupAPI:R8 | `/v2/common/sendOTP/` | POST | payload-rule | payload (sample broken) / yes | Confirm which row is current (duplicate-of V2 TESTED APIS:R8). |
| Sheet3:R10 | `/common/mobileNoExist/` | POST | payload-rule | payload / yes | Confirm the v1 row is retired now that a /v2 row exists. |
| Sheet3:R12 | `/signupLogin/signup/` | POST | payload-rule | payload / yes | Confirm the v1 row is retired now that a /v2 row exists. |
| Sheet3:R14 | `/v2/common/sendOTP/` | POST | payload-rule | payload / yes | Confirm which row is current (duplicate-of V2 TESTED APIS:R8). |
| Sheet3:R15 | `/common/sendOTP/` | GET | payload-rule | no payload / yes | Confirm the v1 row is retired now that a /v2 row exists. |
| Sheet3:R16 | `/v2/common/validateOTP/` | POST | payload-rule | payload / yes | Confirm which row is current (duplicate-of KatchupAPI:R8). |
| Sheet3:R17 | `/common/validateOTP/` | GET | payload-rule | no payload / yes | Confirm the v1 row is retired now that a /v2 row exists. |
| Sheet3:R19 | `/v2/signupLogin/kpostIdExist/` | POST | payload-rule | payload / yes | Confirm which row is current (duplicate-of KatchupAPI:R15). |
| Sheet3:R20 | `/v2/signupLogin/kpostIdExist/` | POST | payload-rule | payload / yes | Confirm which row is current (duplicate-of KatchupAPI:R15). |
| Sheet3:R22 | `/v2/common/sendOTPtoMail/` | POST | payload-rule | payload / yes | Confirm which row is current (duplicate-of KatchupAPI:R12). |
| Sheet3:R23 | `/v2/common/validateMailOTP/` | POST | payload-rule | payload / yes | Confirm which row is current (duplicate-of KatchupAPI:R13). |
| Sheet3:R24 | `/v2/signupLogin/kpostIDsuggestionList/` | POST | payload-rule | payload / yes | Confirm which row is current (duplicate-of KatchupAPI:R16). |

## Gaps that are not per-row

- **No HTTP status codes anywhere.** Nothing says 200 vs 201, and there are no error rows
  (400/401/403/404/409/422). A "Success status" column and a few error samples would let the
  bench assert status instead of assuming it.
- **No auth flag.** Nothing marks an endpoint public vs token-required, or which user type may
  call it. KMail’s "After Token Implemented" column is the only hint.
- **Path/query parameters undocumented.** Templated URLs (e.g. `/v2/katchup/download/{uuid}`)
  have no parameter table, and query strings are not documented at all.
- **Admin module is absent from the workbook entirely** — it has no contract at all.
- **`userType` has labels but no numbers** (`BUSINESS_S/M/L`), unlike every other type group.

