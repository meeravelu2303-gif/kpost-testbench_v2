# Coverage ledger — every endpoint, every screen

**GENERATED — do not edit.** Written by `tests/framework/coverage-ledger.spec.ts`
(`npm run test:framework`). It reconciles the registry against the generated contracts, so it
cannot drift from what is actually tested.

## API — endpoints

| | Count |
| - | ----: |
| Documented (workbook, usable) | 446 |
| **Registered & tested** | **399** |
| — of those, run on live | 138 |
| In "built" modules | 431 |

| Module | Documented | Tested | Live | Status | Note |
| ------ | ---------: | -----: | ---: | ------ | ---- |
| `admin` | 125 | 97 | 29 | built | Admin/HR-Setup module (admin-api, BUSINESS_M). Contract is the live service OpenAPI (112 ops, npm run contract:admin). Scope = the 38 endpoints the PRODUCT actually uses (from the frontend AdminSetup.js/HumanResources.js) — all covered; the other ~74 contract ops are not wired into the product. The core-app /admin/* routes (BUSINESS_S user management) also bucket here |
| `kmail` | 80 | 79 | 30 | built | KMail — test host testkmail (/testkmail/v2). 27 reads all-types on kmail; 28 data writes fuzzed on kmail:deep; 14 needs-id reads via KMAIL_LIFECYCLE (attachment downloads need a real S3 upload — off-live); getKloudUsedData not in the usable contract |
| `profile` | 45 | 45 | 12 | built | profile — full API + write lifecycle + screens |
| `katchup` | 36 | 35 | 9 | built | messaging — full API + write lifecycle + screen |
| `common` | 32 | 32 | 21 | built | reference data, identity, company, OTP (OTP writes gated) |
| `kall` | 20 | 20 | 6 | built | calling — full API + write lifecycle + screen |
| `contacts` | 16 | 16 | 8 | built | address book — reads live, writes gated lifecycle |
| `dairyschedule` | 14 | 14 | 4 | built | KDiary — schedules/events/reports; reads live, writes gated |
| `kword` | 14 | 14 | 0 | built | KOS/KWord — document CRUD; reads live, writes gated (API-only) |
| `signuplogin` | 12 | 12 | 8 | built | login & session; signup out of scope (OTP-gated) |
| `group` | 11 | 11 | 0 | built | group membership (FR-K06) |
| `redbus` | 8 | 5 | 3 | built | KBooking bus search (city/destinations/trips/tripdetails) + blockTicket (gated, KBOOKING_LIFECYCLE); reclassified Category-A 2026-10-02 — frontend-active, confirmed no rzp_test_ payment sandbox exists. bookticket/cancelticket/getTicket/checkBookedTicket are real+active but undocumented in the workbook contract — blocked on the workbook owner, see kbooking.api.ts header |
| `generalsetting` | 7 | 7 | 2 | built | Settings — theme/font/notifications; reads live, writes gated |
| `ai` | 4 | 4 | 1 | built | KOS K-AI — sessions read live; generation metered/external |
| `aws` | 4 | 4 | 3 | built | S3 presigned URLs + attachment check/delete; generators run live |
| `dashboard` | 3 | 3 | 2 | built | home recent-messages panel |
| `other` | 1 | 0 | 0 | backlog | unprefixed paths — review individually |
| `signuploginformediumandlarge` | 1 | 1 | 0 | needs-business | business-tier admin login |
| `knews` | 6 | 0 | 0 | external | external RSS feeds, not the KPost API |
| `kpresentation` | 4 | 0 | 0 | out-of-scope | KDOC — out of scope per BRD §4.2 |
| `ecommerce` | 2 | 0 | 0 | out-of-scope | third-party commerce; confirm scope with owner |
| `metadee` | 1 | 0 | 0 | out-of-scope | third-party; confirm scope with owner |

### Uncovered documented paths (the backlog, module by module)

**`admin`** (28) — built

- `/userDetails/validateOTP`
- `/userDetails/update`
- `/userDetails/signUp`
- `/userDetails/sendOTP`
- `/userDetails/save`
- `/userDetails/resetPassword`
- `/userDetails/registration`
- `/userDetails/login`
- `/userDetails/generateUserIdSuggestions`
- `/userDetails/createCommunicationId`
- `/userDetails/checkAvailability`
- `/rolePosting/softDelete`
- `/rolePosting/getRolePostingById`
- `/rolePosting/getEmployeeDetailsByLastHrvariableId`
- `/rolePosting/getAssignedRolePostingEmployeeByCompanyId`
- `/project/saveAllProject`
- `/productPurchase/save`
- `/productMaster/save`
- `/productEmployeeMapping/save`
- `/productEmployeeMapping/saveKpostIdForKams`
- `/holiday/saveHoliday`
- `/employeeRoleMapping/save`
- `/demo/createDemoRequest`
- `/country/save`
- `/adminDetails/save`
- `/userDetails/getAllUser/{companyId}`
- `/`
- `/userDetails/delete/{id}`

**`kmail`** (1) — built

- `/kmail5/v2/kmailData/getKloudUsedData`

**`katchup`** (1) — built

- `/v2/katchup/forwardKatchupMessage/`

**`redbus`** (3) — built

- `/redbus/boardingPoint/`
- `/redbus/tripdetailsV2/`
- `/redbus/updatecitylist`

**`other`** (1) — backlog

- `/delete?presentationId={presentationId}`

**`knews`** (6) — external

- `/v2/knews/getAllCategories/`
- `/v2/knews/getAllNewsSource/`
- `/v2/knews/getKnewsSettings/`
- `/v2/knews/getPublicationByLanguageId/`
- `/v2/knews/getSubCategoriesByCategoryId/`
- `/v2/knews/updateKnewsSettings/`

**`kpresentation`** (4) — out-of-scope

- `/kpresentation/create`
- `/kpresentation/presentations`
- `/kpresentation/presentations/{presentationId}`
- `/kpresentation/savePresentation`

**`ecommerce`** (2) — out-of-scope

- `/v2/ecommerce/getAll`
- `/v2/ecommerce/getEcommerceDetails/`

**`metadee`** (1) — out-of-scope

- `/metaDee/aiMessage`

## Screens

Covered: **12 / 15** routes.

| Route | e2e spec | Note |
| ----- | -------- | ---- |
| `/login` | `login.spec.ts` | two-step login |
| `/home` | `home.spec.ts` | landing + recent panel |
| `(shell)` | `shell.spec.ts` | header + nav rail (all screens) |
| `/katchup` | `katchup.spec.ts` | messaging |
| `/kall` | `kall.spec.ts` | calling |
| `/kmail` | `kmail.spec.ts` | email |
| `/userprofile` | `profile.spec.ts` | profile + settings |
| `/settings` | `settings.spec.ts` | settings workspace |
| `/kdirectory` | — | out of scope per BRD §4.2 |
| `/kcloud` | `auxiliary.spec.ts` | smoke (no API) |
| `/kbooking` | `auxiliary.spec.ts` | smoke (no API) |
| `/knews` | `auxiliary.spec.ts` | smoke (external RSS) |
| `/e-commerce` | `auxiliary.spec.ts` | smoke (third-party) |
| `/kdoc` | — | KOS "Coming Soon" today |
| `/usermanagement` | — | admin — needs a business account |

## What "complete" is blocked on

- **OTP-gated endpoints never run on live** (no bypass — a security property). `npm run contract:otp`.
- **`needs-business` modules** (admin, business-tier login) need a business company with members.
- **`external`/`out-of-scope`** modules (KNews RSS, RedBus/ECommerce/MetaDee, KDOC) await an owner
  scope decision or are excluded per the BRD.

