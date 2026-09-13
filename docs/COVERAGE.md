# Coverage ledger — every endpoint, every screen

**GENERATED — do not edit.** Written by `tests/framework/coverage-ledger.spec.ts`
(`npm run test:framework`). It reconciles the registry against the generated contracts, so it
cannot drift from what is actually tested.

## API — endpoints

| | Count |
| - | ----: |
| Documented (workbook, usable) | 334 |
| **Registered & tested** | **291** |
| — of those, run on live | 103 |
| In "built" modules | 298 |

| Module | Documented | Tested | Live | Status | Note |
| ------ | ---------: | -----: | ---: | ------ | ---- |
| `kmail` | 80 | 75 | 32 | built | KMail — reads live, compose/draft/settings write lifecycle (host kmail5, /kmail5/v2) |
| `profile` | 45 | 45 | 12 | built | profile — full API + write lifecycle + screens |
| `katchup` | 36 | 36 | 10 | built | messaging — full API + write lifecycle + screen |
| `common` | 32 | 32 | 14 | built | reference data, identity, company, OTP (OTP writes gated) |
| `kall` | 20 | 20 | 6 | built | calling — full API + write lifecycle + screen |
| `contacts` | 16 | 16 | 8 | built | address book — reads live, writes gated lifecycle |
| `dairyschedule` | 14 | 14 | 5 | built | KDiary — schedules/events/reports; reads live, writes gated |
| `kword` | 14 | 14 | 1 | built | KOS/KWord — document CRUD; reads live, writes gated (API-only) |
| `signuplogin` | 12 | 8 | 6 | built | login & session; signup out of scope (OTP-gated) |
| `group` | 11 | 11 | 0 | built | group membership (FR-K06) |
| `generalsetting` | 7 | 7 | 2 | built | Settings — theme/font/notifications; reads live, writes gated |
| `ai` | 4 | 4 | 1 | built | KOS K-AI — sessions read live; generation metered/external |
| `aws` | 4 | 4 | 3 | built | S3 presigned URLs + attachment check/delete; generators run live |
| `dashboard` | 3 | 3 | 3 | built | home recent-messages panel |
| `other` | 1 | 0 | 0 | backlog | unprefixed paths — review individually |
| `admin` | 13 | 1 | 0 | needs-business | org/HR admin — needs a business company with members |
| `signuploginformediumandlarge` | 1 | 1 | 0 | needs-business | business-tier admin login |
| `knews` | 6 | 0 | 0 | external | external RSS feeds, not the KPost API |
| `redbus` | 8 | 0 | 0 | out-of-scope | third-party travel booking; confirm scope with owner |
| `kpresentation` | 4 | 0 | 0 | out-of-scope | KDOC — out of scope per BRD §4.2 |
| `ecommerce` | 2 | 0 | 0 | out-of-scope | third-party commerce; confirm scope with owner |
| `metadee` | 1 | 0 | 0 | out-of-scope | third-party; confirm scope with owner |

### Uncovered documented paths (the backlog, module by module)

**`kmail`** (5) — built

- `/kmail5/common/getKmailDashboardMsg/`
- `/kmail5/readMail/getKmailDetailsUsingKmailID/`
- `/kmail5/v2/kmailData/getKloudUsedData`
- `/v2/kmailSetting/deleteCustomizedInstantReply`
- `/v2/kmailSetting/saveOrUpdateCustomizedInstantReply`

**`signuplogin`** (4) — built

- `/v2/signupLogin/adminRegistration/`
- `/v2/signupLogin/kpostIdExist/`
- `/v2/signupLogin/kpostIDsuggestionList/`
- `/v2/signupLogin/signup/`

**`other`** (1) — backlog

- `/delete?presentationId={presentationId}`

**`admin`** (12) — needs-business

- `/admin/addingUserByAdmin/`
- `/admin/createOrRemoveBackupAdmin/`
- `/admin/displayNameSuggestion`
- `/admin/getBankAndCompanyDetails/{companyID}`
- `/admin/holdOrRelease/`
- `/admin/resetPassword/`
- `/admin/terminateUser/`
- `/admin/userManagementDetails/{companyID}`
- `/v2/admin/createKpostIDAndDesignationSuggestion`
- `/v2/admin/updateBankAccountDetails`
- `/v2/admin/updateCompanyDetails`
- `/v2/admin/updateRole`

**`knews`** (6) — external

- `/v2/knews/getAllCategories/`
- `/v2/knews/getAllNewsSource/`
- `/v2/knews/getKnewsSettings/`
- `/v2/knews/getPublicationByLanguageId/`
- `/v2/knews/getSubCategoriesByCategoryId/`
- `/v2/knews/updateKnewsSettings/`

**`redbus`** (8) — out-of-scope

- `/redbus/availabletrips/`
- `/redbus/blockTicket/{kpostId}`
- `/redbus/boardingPoint/`
- `/redbus/citysuggestion/chennai`
- `/redbus/destinations/`
- `/redbus/tripdetails/`
- `/redbus/tripdetailsV2/`
- `/redbus/updatecitylist`

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

