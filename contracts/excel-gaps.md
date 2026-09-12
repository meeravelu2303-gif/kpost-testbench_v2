# Excel gaps — what to fill in the workbook

Generated from the parsed contracts. 348 rows need something; open
`contracts/excel-gaps.csv` in Excel for the full list (it has Tab + Row to find each cell).

| Priority | Meaning | Rows |
| --- | --- | ---: |
| P1 | **HTTP method missing** — blocks the endpoint entirely | 207 |
| P2 | Request payload and/or sample response missing | 104 |
| P3 | JSON cell has prose mixed in, so it cannot be parsed | 9 |
| P4 | Duplicate or legacy row — confirm which is current | 4 |
| P5 | Retired (yellow) — confirm out of scope | 24 |

## P1 — missing HTTP method, by module

| Module | Rows |
| --- | ---: |
| kpost-api · (no module) | 28 |
| kpost-api · profile | 22 |
| kpost-api · katchup | 19 |
| kpost-api · Common | 14 |
| kpost-api · common | 12 |
| kpost-api · Admin | 12 |
| kpost-api · Signup | 7 |
| kpost-api · contacts | 7 |
| kpost-api · Integration | 7 |
| kpost-api · Katchup | 7 |
| kpost-api · Kword | 7 |
| kpost-api · group | 5 |
| kpost-api · KALLv2  Kool Kall | 5 |
| kpost-api · KALLv2 | 5 |
| kpost-api · Profile | 5 |
| kpost-api · General Setting | 5 |
| kpost-api · Group | 4 |
| kmail-api · Kmail | 3 |
| kpost-api · Contacts | 3 |
| kpost-api · KALL | 3 |
| kpost-api · AI | 3 |
| kpost-api · Knews | 3 |
| kpost-api · dashboard | 2 |
| kpost-api · AWS katchup | 2 |
| kpost-api · Login | 2 |
| kpost-api · kall | 2 |
| kpost-api · Kmail | 2 |
| kpost-api · KPresentation | 2 |
| kpost-api · KALLv2  Kool Kall & individual Kool | 1 |
| kpost-api · generatePresignedUrl KMAIL | 1 |
| kpost-api · KMAIL READMAIL | 1 |
| kpost-api · kmail SENTMAIL | 1 |
| kpost-api · Dashboard | 1 |
| kpost-api · Business,Institution sigunp | 1 |
| kpost-api · KMail | 1 |
| kpost-api · Kall | 1 |
| kpost-api · signupLoginForMediumAndLarge | 1 |

The CSV has a `SuggestedMethod` column (`GET?` / `POST?`) guessed from the endpoint name to speed
this up. **It is a hint — confirm each one.** The converter never reads it.

## First 15 rows of each priority

### P1 (207 rows)

| Tab:Row | Path | Endpoint | Has req / res | Suggested | Action |
| --- | --- | --- | --- | --- | --- |
| KMAILAPI:R39 | `/common/deleteOtherDomainContact/` | — | yes / no | POST? | Add the HTTP method (GET/POST/PUT/DELETE) for this row. |
| KMAILAPI:R40 | `/common/editOtherDomainContactsDetails/` | — | yes / no | POST? | Add the HTTP method (GET/POST/PUT/DELETE) for this row. |
| KMAILAPI:R41 | `/common/knownPostBoxContacts/` | — | yes / no | — | Add the HTTP method (GET/POST/PUT/DELETE) for this row. |
| KatchupAPI:R2 | `/v2/profile/fetchUserDetails/` | fetchUserDetails | yes / yes | GET? | Add the HTTP method (GET/POST/PUT/DELETE) for this row. |
| KatchupAPI:R3 | `/v2/profile/fetchUserDetails/` | fetchUserDetails | no / yes | GET? | Add the HTTP method (GET/POST/PUT/DELETE) for this row. |
| KatchupAPI:R3 | `/v2/signupLogin/fetchUserDetails/` | — | no / yes | GET? | Add the HTTP method (GET/POST/PUT/DELETE) for this row. |
| KatchupAPI:R4 | `/v2/signupLogin/userLogin/` | userLogin | text only / yes | — | Add the HTTP method (GET/POST/PUT/DELETE) for this row. |
| KatchupAPI:R5 | `/v2/signupLogin/generateJWTokens/` | generateJWTokens | yes / yes | POST? | Add the HTTP method (GET/POST/PUT/DELETE) for this row. |
| KatchupAPI:R6 | `/v2/common/msStatus/` | msStatus | no / text only | — | Add the HTTP method (GET/POST/PUT/DELETE) for this row. |
| KatchupAPI:R7 | `/v2/common/forgotPasswordUpdate` | forgotPasswordUpdate | yes / yes | POST? | Add the HTTP method (GET/POST/PUT/DELETE) for this row. |
| KatchupAPI:R7 | `/v2/profile/changePassword` | changePassword | yes / yes | POST? | Add the HTTP method (GET/POST/PUT/DELETE) for this row. |
| KatchupAPI:R8 | `/v2/common/sendOTP/` | sendOTP | text only / yes | POST? | Add the HTTP method (GET/POST/PUT/DELETE) for this row. |
| KatchupAPI:R8 | `/v2/common/validateOTP/` | validateOTP | yes / yes | POST? | Add the HTTP method (GET/POST/PUT/DELETE) for this row. |
| KatchupAPI:R9 | `/v2/common/forgotPasswordOTPOrSentKpostIDSms` | forgotPasswordOTPOrSentKpostIDSms | yes / yes | POST? | Add the HTTP method (GET/POST/PUT/DELETE) for this row. |
| KatchupAPI:R10 | `/v2/common/countries` | countries | text only / yes | GET? | Add the HTTP method (GET/POST/PUT/DELETE) for this row. |

### P2 (104 rows)

| Tab:Row | Path | Endpoint | Has req / res | Suggested | Action |
| --- | --- | --- | --- | --- | --- |
| KMAILAPI:R5 | `/common/postBoxContacts/` | — | text only / yes | — | Add the request payload. |
| KMAILAPI:R16 | `/common/frequentKmailContact/` | — | text only / yes | — | Add the request payload. |
| KMAILAPI:R17 | `/common/unOpenedMailCountBySenderID/` | — | text only / yes | — | Add the request payload. |
| KMAILAPI:R18 | `/common/miscellaneousContacts/` | — | text only / yes | — | Add the request payload. |
| KMAILAPI:R19 | `/common/convertMailAsPDF/` | — | no / no | — | Add the request payload and a sample response. |
| KMAILAPI:R23 | `/sentMail/loadOtherDomainMails/` | — | text only / yes | — | Add the request payload. |
| KMAILAPI:R25 | `/draft/getAllDraftMails/` | — | text only / yes | — | Add the request payload. |
| KMAILAPI:R26 | `/draft/getDraftMailsContacts/` | — | text only / yes | — | Add the request payload. |
| KMAILAPI:R30 | `/readMail/referenceMailContent/` | — | yes / no | — | Add a sample response. |
| KMAILAPI:R38 | `/kmailSetting/getDigitalSignature` | — | text only / no | — | Add a sample response. |
| KMAILAPI:R42 | `/common/statusOfKmailsContactsTotalCount/` | — | text only / no | — | Add a sample response. |
| KMAILAPI:R45 | `/v2/sentMail/postMail/` | — | yes / no | — | Add a sample response. |
| KMAILAPI:R46 | `/readMail/getCopiesInfo/{kmailID}` | — | no / no | — | Add a sample response. |
| KMAILAPI:R47 | `/v2/aws/generate-presigned-url` | — | yes / no | — | Add a sample response. |
| KMAILAPI:R48 | `/v2/readMail/downloadODAttachment` | — | yes / no | — | Add a sample response. |

### P3 (9 rows)

| Tab:Row | Path | Endpoint | Has req / res | Suggested | Action |
| --- | --- | --- | --- | --- | --- |
| KMAILAPI:R15 | `/common/getAllImportantMails/` | — | yes / text only | — | Fix the JSON — prose is mixed into it (response-unparseable). |
| KMAILAPI:R20 | `/common/selectedContactMails/` | — | text only / no | — | Fix the JSON — prose is mixed into it (request-unparseable). |
| KMAILAPI:R24 | `/draft/draftMail/` | — | text only / yes | — | Fix the JSON — prose is mixed into it (request-unparseable). |
| KMAILAPI:R31 | `/readMail/sentAndInboxMailContent/` | — | text only / yes | — | Fix the JSON — prose is mixed into it (request-unparseable). |
| KMAILAPI:R43 | `/common/clearStatusOfKmailsContacts/` | — | text only / no | — | Fix the JSON — prose is mixed into it (request-unparseable). |
| KMAILAPI:R44 | `/draft/draftMailMultiPart` | — | text only / no | — | Fix the JSON — prose is mixed into it (request-unparseable). |
| KMAILAPI:R54 | `/common/clearStatusOfAllKmailsContacts` | — | text only / no | — | Fix the JSON — prose is mixed into it (request-unparseable). |
| KatchupAPI:R70 | `/v2/katchup/downloadThumbnail/{uuid}` | — | text only / text only | — | Fix the JSON — prose is mixed into it (response-unparseable). |
| KDIARY:R5 | `/dairySchedule/createEvent` | — | no / text only | — | Fix the JSON — prose is mixed into it (response-unparseable). |

### P4 (4 rows)

| Tab:Row | Path | Endpoint | Has req / res | Suggested | Action |
| --- | --- | --- | --- | --- | --- |
| KMAILAPI:R37 | `/common/postBoxContacts/` | — | yes / no | — | Confirm which row is current (duplicate-of KMAILAPI:R5). |
| KatchupAPI:R89 | `/v2/kall/todayKoolKall/` | — | text only / yes | — | Confirm which row is current (duplicate-of KatchupAPI:R78). |
| KatchupAPI:R92 | `/v2/kall/frequentKallContacts` | — | text only / yes | — | Confirm which row is current (duplicate-of KatchupAPI:R54). |
| KatchupAPI:R94 | `/v2/kall/clearKallHistory` | — | text only / yes | — | Confirm which row is current (duplicate-of KatchupAPI:R57). |

### P5 (24 rows)

| Tab:Row | Path | Endpoint | Has req / res | Suggested | Action |
| --- | --- | --- | --- | --- | --- |
| KMAILAPI:R7 | `/common/statusOfKmailsContacts/` | — | text only / yes | — | None — retired (yellow). Confirm it can stay out of scope. |
| KMAILAPI:R21 | `/sentMail/postMail/` | — | text only / yes | — | None — retired (yellow). Confirm it can stay out of scope. |
| KMAILAPI:R22 | `/sentMail/postMailMultiPart/` | — | yes / yes | — | None — retired (yellow). Confirm it can stay out of scope. |
| KMAILAPI:R59 | `/kmailSetting/letterHeadUpload` | — | text only / no | — | None — retired (yellow). Confirm it can stay out of scope. |
| KatchupAPI:R23 | `/v2/dashboard/kallDashboard/` | — | yes / yes | — | None — retired (yellow). Confirm it can stay out of scope. |
| KatchupAPI:R24 | `/v2/contacts/katchupContacts` | — | text only / yes | — | None — retired (yellow). Confirm it can stay out of scope. |
| KatchupAPI:R29 | `/v2/contacts/fetchAdditionalKatchupContacts/` | — | text only / yes | — | None — retired (yellow). Confirm it can stay out of scope. |
| KatchupAPI:R51 | `/v2/kall/initiateKall` | — | text only / yes | — | None — retired (yellow). Confirm it can stay out of scope. |
| KatchupAPI:R52 | `/v2/kall/checkNewKall` | — | text only / yes | — | None — retired (yellow). Confirm it can stay out of scope. |
| KatchupAPI:R53 | `/v2/kall/getKallStatus` | — | yes / yes | GET? | None — retired (yellow). Confirm it can stay out of scope. |
| KatchupAPI:R54 | `/v2/kall/frequentKallContacts` | — | text only / yes | — | None — retired (yellow). Confirm it can stay out of scope. |
| KatchupAPI:R55 | `/v2/kall/setKallStatus` | — | yes / yes | POST? | None — retired (yellow). Confirm it can stay out of scope. |
| KatchupAPI:R56 | `/v2/kall/clearKallBykallIds` | — | yes / yes | POST? | None — retired (yellow). Confirm it can stay out of scope. |
| KatchupAPI:R57 | `/v2/kall/clearKallHistory` | — | text only / yes | — | None — retired (yellow). Confirm it can stay out of scope. |
| KatchupAPI:R58 | `/v2/kall/katchupKall` | — | yes / yes | — | None — retired (yellow). Confirm it can stay out of scope. |

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

