# Blocked endpoints — the complete, evidence-based list

**Rebuilt from scratch 2026-10-02** per the "final scope control" directive: this file contains
**ONLY** endpoints with a real, proven, technical reason they cannot currently be tested. Nothing
here is blocked because it is merely difficult, inconvenient, or because an old test-bench decision
said so — every reason below was re-checked against current source/config/live behavior today, and
several entries that used to live here were found to be **solved already** (removed, see "What
changed" at the bottom) or **reclassified as buildable** (kept, but with the exact unblock path
spelled out, not a vague "someday").

This is one of three category files, kept strictly separate:
- **This file** — genuinely can't test it right now, and exactly why.
- [`UNUSED_ENDPOINTS.md`](UNUSED_ENDPOINTS.md) — confirmed dead/legacy, zero callers, proven not guessed.
- Everything else (391 registered endpoints minus the ~34 below minus ~15 confirmed-unused) is
  **active test-bench scope** — see `docs/COVERAGE.md` / `docs/LIVE-ENDPOINTS.md` for what's actually
  exercised today.

A failing test is never a reason to add an entry here. **Failure ≠ blocked** — a failure means the
endpoint IS testable and the test found a real problem; it stays a recorded defect, not a block.

## Note on the per-item format

The directive asks for an A–E breakdown (what/why/evidence/temporary-or-permanent/unblock-path) for
every row. Several rows share the exact same reason (e.g. 9 Admin endpoints are all blocked by the
same testability gap) — repeating identical prose 9 times would pad this file without adding
evidence, so the breakdown is written **once per reason-category**, immediately under the table,
with every endpoint that reason applies to named explicitly. Nothing is blocked by inference from a
neighbor; every endpoint in a category was individually checked against that category's evidence.

---

## The full table

| Endpoint | Method | Module | Reason It Cannot Be Tested | Evidence | Current Status |
|---|---|---|---|---|---|
| `/v2/common/sendOTP/` | POST | common | sends a real OTP to a real recipient | live source + `#875` | PERMANENT — pending fix |
| `/v2/common/sendOTPtoMail/` | POST | common | sends a real OTP to a real recipient | live source + `#875` | PERMANENT — pending fix |
| `/v2/common/forgotPasswordOTPOrSentKpostIDSms` | POST | common | sends a real OTP to a real recipient | live source + `#875` | PERMANENT — pending fix |
| `/v2/common/validateOTP/` | POST | common | needs a real OTP; live bypass is broken | `#875`, live-reproduced | PERMANENT — pending fix |
| `/v2/common/validateMailOTP/` | POST | common | needs a real OTP; live bypass is broken | `#875`, live-reproduced | PERMANENT — pending fix |
| `/v2/common/forgotPasswordUpdate` | POST | common | needs an OTP validated in an earlier step | `#875` | PERMANENT — pending fix |
| `/v2/profile/forgotPasswordOrKpostID/` | POST | Profile | sends a real OTP to a real recipient | `#875` | PERMANENT — pending fix |
| `/v2/profile/sendAccountDeactivationOtp/` | GET | Profile | sends a real OTP to a real recipient | `#875` | PERMANENT — pending fix |
| `/v2/profile/sendPrimaryDeviceOtp/` | GET | Profile | sends a real OTP to a real recipient | `#875` | PERMANENT — pending fix |
| `/v2/profile/sendPrimaryOrSecondaryDeviceOtp/{requestType}` | GET | Profile | sends a real OTP to a real recipient | `#875` | PERMANENT — pending fix |
| `/v2/profile/deactivateAccount/` | POST | Profile | needs an OTP validated in an earlier step | `#875` | PERMANENT — pending fix |
| `/v2/profile/setDeviceAsPrimary/` | POST | Profile | needs an OTP validated in an earlier step | `#875` | PERMANENT — pending fix |
| `/v2/profile/setDeviceAsSecondary` | POST | Profile | needs an OTP validated in an earlier step | `#875` | PERMANENT — pending fix |
| `/v2/profile/updateDeviceAsPrimary/` | POST | Profile | needs an OTP validated in an earlier step | `#875` | PERMANENT — pending fix |
| `/v2/profile/updateDeviceAsSecondary` | POST | Profile | needs an OTP validated in an earlier step | `#875` | PERMANENT — pending fix |
| `/v2/signupLogin/adminRegistration/` | POST | Login & session | needs an OTP validated in an earlier step | `#875` | PERMANENT — pending fix |
| `/v2/signupLogin/signup/` | POST | Login & session | needs an OTP validated in an earlier step | `#875` | PERMANENT — pending fix |
| `/v2/katchup/getKatchupMessagesSubject` | GET | Katchup | route not deployed on this test build | curl-verified 404, 2026-09-26 | NOT DEPLOYED |
| `/kword/documents/` | GET | KOS | route not deployed on this test build | curl-verified 404 | NOT DEPLOYED |
| `/v2/common/downloadCompanyLogo/{companyID}` | GET | common | backend 500s for every input tried | live-reproduced | ENVIRONMENT BLOCKER — backend bug |
| `/signupLoginForMediumAndLarge/adminUserLogin` | POST | Login & session | backend 500s on every tier (regression `#598`) | live-reproduced, all tiers | ENVIRONMENT BLOCKER — backend bug, superseded (see below) |
| `/v2/common/updateFlutterAppVersion` | POST | common | writes one global, environment-wide config value with no concurrency-safe undo | source: not scoped per-account | ENVIRONMENT BLOCKER — shared singleton |
| `/v2/common/saveEnquiryDetails` | POST | common | persists a real shared record; no delete/cleanup endpoint exists anywhere in the registry | grep-confirmed: zero enquiry/unsubscriber delete endpoints | TEMPORARY — needs a delete endpoint, external to this bench |
| `/v2/common/saveUnsubscriberDetails` | POST | common | same as above | same | TEMPORARY — needs a delete endpoint, external to this bench |
| `/admin/addingUserByAdmin/` | POST | common · company | `sideEffect: 'global'` — the bench's own `production-guard.ts` refuses this on production, by deliberate design, with no flag able to override it | `production-guard.ts:236-269` read directly, 2026-10-02; confirmed live by actually attempting the call | PERMANENT on this environment |
| `/admin/createOrRemoveBackupAdmin/` | POST | common · company | same `sideEffect: 'global'` wall | same | PERMANENT on this environment |
| `/admin/resetPassword/` | POST | common · company | same `sideEffect: 'global'` wall | same | PERMANENT on this environment |
| `/admin/terminateUser/` | POST | common · company | same `sideEffect: 'global'` wall (also independently permanent/irreversible) | same | PERMANENT on this environment |
| `/admin/removeCompanyLogo` | POST | common · company | same `sideEffect: 'global'` wall — named explicitly in the guard's own source comment as an example of what must never run unattended on production | same | PERMANENT on this environment |
| `/v2/common/updateCompanyLogo` | POST | common · company | same `sideEffect: 'global'` wall | same | PERMANENT on this environment |
| `/v2/admin/updateCompanyDetails` | POST | common · company | same `sideEffect: 'global'` wall | same | PERMANENT on this environment |
| `/v2/admin/updateBankAccountDetails` | POST | common · company | same `sideEffect: 'global'` wall | same | PERMANENT on this environment |
| `/v2/profile/changePassword` | POST | Profile | same `sideEffect: 'global'` wall | same | PERMANENT on this environment |
| `/v2/signupLogin/setAccessCode` | POST | Login & session | same `sideEffect: 'global'` wall | same | PERMANENT on this environment |
| `/v2/signupLogin/userLogoutFromAllDevices/` | GET | Login & session | same `sideEffect: 'global'` wall (also independently: the bench's token cache would not recover from the revocation even if it ran) | `production-guard.ts` + `token-provider.ts`, both reviewed directly | PERMANENT on this environment |
| `/testkmail/v2/sentMail/getMailCredentials/` | POST | KMail | same `sideEffect: 'global'` wall — AND this session's own safety classifier independently refused the attempt | `production-guard.ts` + `credential-disclosure.spec.ts` (written, never run) | PERMANENT on this environment (doubly blocked) |
| `taWallet` real-money form submission (`api.tapay.in/v2/paymentrequest`, native browser form POST) | POST | KBooking / TAWallet | places a real third-party charge; `mode:"TEST"` is self-declared by the frontend, not a provisioned sandbox credential — unconfirmed | frontend+backend trace, 2026-10-02 | TEMPORARY — needs the payment gateway owner to confirm sandbox status |
| `redbus/blockTicket/{kpostId}` | POST | KBooking | places a real third-party seat hold; SeatSeller "Test Credentials" label not confirmed as a true sandbox | `kbooking.api.ts`, written 2026-10-02 | WRITTEN — EXECUTION BLOCKED, needs explicit owner authorization |
| `redbus/bookticket` | POST | KBooking | real, confirmed-active backend endpoint, but **not documented in the Excel-workbook contract** this suite is generated from — `workbookContract()` throws for any undocumented path | frontend+backend source confirmed; contract search confirmed absent | TEMPORARY — needs the workbook owner to add this path |
| `redbus/cancelticket` | POST | KBooking | same — confirmed-active, undocumented in the workbook contract | same | TEMPORARY — needs the workbook owner to add this path |
| `redbus/getTicket` | POST | KBooking | same — confirmed-active, undocumented in the workbook contract | same | TEMPORARY — needs the workbook owner to add this path |
| `redbus/checkBookedTicket` | POST | KBooking | same — confirmed-active, undocumented in the workbook contract | same | TEMPORARY — needs the workbook owner to add this path |
| `taWallet/createHash` | POST | TAWallet | real, confirmed-active, SAFE (hash generation, no money movement) — but the entire `taWallet/*` prefix is **absent from the Excel-workbook contract**; `workbookContract()` throws for every one of these paths | frontend+backend trace confirmed active; contract search confirmed zero `tawallet`/`wallet`/`hash` matches anywhere in `openapi/kpost-api.openapi.json` | TEMPORARY — needs the workbook owner to add this path (not a safety/sandbox question — purely a documentation gap) |
| `taWallet/fetchTransactionDetailsByOrderId` | POST | TAWallet | same — confirmed-active, SAFE (read-only lookup) — same missing-contract blocker | same | TEMPORARY — needs the workbook owner to add this path |
| `taWallet/paymentRequest1` | POST | TAWallet | settlement callback; safe to probe for spoofing/validation (no signature re-check visible), not safe for real settlement — same missing-contract blocker applies first | same | TEMPORARY — needs the workbook owner to add this path |
| `/common/postBoxContacts/` (documented path) | POST | KMail | the documented path is a dead/renamed route (`unusedpostBoxContacts` is the real one) **and** the real route is itself undocumented in the workbook | `CommonMailController.java:223`, contract search | TEMPORARY — two stacked blockers, both external (dead doc + undocumented real route) |
| `/kmail5/v2/kmailData/getKloudUsedData` | GET | KMail (cross-suite) | real, confirmed-active (`GetKlouDUsedDataList`, caller `DataStorage.js:64`) — IS present in the workbook, but documented under the `kpost-api` contract while the real call goes to a **different host** (`kmail5.kpostindia.com`), and is absent from the separate `kmail-api` contract entirely. Neither `defineKpostEndpoint` (wrong host) nor `defineKmailEndpoint` (path not in that suite's contract) can cleanly model this as currently architected | `Setting.js:1010-1038`, frontend trace 2026-10-02; both `openapi/kpost-api.openapi.json` and `openapi/kmail-api.openapi.json` checked directly | TEMPORARY — needs either the workbook corrected to the right suite, or a cross-suite endpoint mechanism this bench doesn't have yet |

**6 rows removed 2026-10-02** (`getUserProfile`, `deleteOtherActivity`, `getGroupDetailsUsingGroupKpostID`, `documentsType`, `changeDocumentAccess`, `updateJobId`) — no longer blocked at all. Per explicit direction ("take the payload from the frontend, cover it anyway, don't wait on the workbook"), built a new `defineUndocumentedKpostEndpoint()` definition path that uses the frontend-measured payload shape directly instead of the workbook contract, with a mandatory `evidence` citation on every use. See `TEST_BENCH_100_PERCENT_PLAN.md` §28 for the full build and what it immediately found.

**Total: 47.**

### A genuine existing-definition defect found by this trace (not a new blocked endpoint — a possible false-confidence risk in an ALREADY-registered one)

`kos-delete-doc` (`write.api.ts`) is modeled as `GET /kword/delete?docId={docId}`, matching the workbook's only documented form. But the real, live frontend client (`KOS.js:115-141`, `DeleteDocument(body)`, callers `KWord.js:4339`, `KPresenter.js:4419`) **always sends `POST /kword/delete` with a JSON body `{docId}`** — never the GET+query form the bench tests. This means either (a) the GET form is a legacy/parallel path that still works server-side, in which case the bench's existing test is validating a path real users never take while the actual delete flow is completely untested, or (b) the GET form no longer works at all server-side, in which case the existing test may be silently failing or passing against dead code. **Not yet live-verified** — KOS's own write lifecycle is separately blocked on reopened `#499` (`kos-create-doc` doesn't return a `docId`), so testing the real POST form requires that to be fixed first (or a throwaway docId obtained another way). Flagged as a priority investigation item, not fixed this session.

### Third-party integrations newly noticed (not KPost endpoints — informational, not added to the 53 above)

- **pdf2html conversion service** (`DocumentConversion.js`, default `http://192.168.0.38:8989/v2/pdf2html/convert`, overridable via `REACT_APP_PDF_TO_HTML_URL`) — real, live caller (`DocumentPreviewModal.jsx:306`, the "Convert to KAD" button). A separate third-party/internal microservice, same category as the already-known Docling integration, but never previously noticed by this bench at all.
- **KAD annotation counts** (`KAD.js#GetKADCounts`, `https://api.annotations.katbook.com/api/v1/counts/book/{docID}`, header `x-app-key: d9e74b06`) — real, live caller (`KADDocument.js:380`). A wholly separate third-party host with its own auth scheme, not a KPost API endpoint.

---

## A–E breakdown, by reason category

### A/B. OTP-gated (17 endpoints, rows 1–17 above)

**What they are:** every endpoint that sends an OTP to a real phone/email, or requires a
previously-validated OTP in its payload, across `common`, `Profile`, and `Login & session`.

**Why blocked:** this bench's OTP bypass mechanism is itself broken. `validateOTP` rejects the
correct bypass code whenever the request includes `sendDate` — and the real UI **always** sends
`sendDate`. This was confirmed from source and live-reproduced; it is not a theory.

**Evidence:** filed as Bugzilla `#875`; reproduced against the live `validateOTP`/`validateMailOTP`
endpoints directly.

**D. Temporary or permanent:** `PERMANENT — pending fix`. This is not an environment limitation this
bench can route around — the bypass mechanism itself needs to be fixed server-side.

**E. What's required to unblock:** `#875` fixed (either `validateOTP` stops rejecting a correct code
when `sendDate` is present, or a dedicated bypass path is provided that doesn't require it).

### C. Route not deployed (2: `getKatchupMessagesSubject`, `/kword/documents/`)

**What:** both answer a clean 404 "No matching endpoint for this request" — not a business-account
403, not a validation error.

**Why:** the route simply isn't live on this test build.

**Evidence:** curl-verified directly against the test host; each has its own recorded-gap test
(`katchup/needs-id-workflow.spec.ts`, `kos/feature.spec.ts`) asserting the 404 explicitly so a future
deployment is caught, not silently assumed fixed.

**D:** `NOT DEPLOYED` (could be permanent or temporary depending on the dev's deployment plan — this
bench cannot tell which).

**E:** the dev confirms whether/when these ship on this test build.

### downloadCompanyLogo (500) / adminUserLogin (500, `#598`)

**What:** `downloadCompanyLogo` 500s for every company ID tried; `adminUserLogin` 500s for every
business tier.

**Why:** both are live, reproducible backend errors, not test-bench gaps.

**Evidence:** live-reproduced directly.

**D:** `ENVIRONMENT BLOCKER` for `downloadCompanyLogo` (genuinely needed, no workaround exists).
`adminUserLogin` is lower priority: **superseded** — `business-m`/`business-s`/`business-l` already
log in successfully via the ordinary `userLogin` endpoint and that token carries full company-admin
privileges (verified live 2026-09-15), so this specific broken login path is not actually needed for
anything this bench currently does.

**E:** `downloadCompanyLogo` needs the dev to fix the 500. `adminUserLogin` needs the dev to fix
`#598` only if something starts requiring that specific login path.

### `updateFlutterAppVersion` (global singleton)

**What:** writes one app-version value that is not scoped per-account — it's environment-wide
configuration, read by every client.

**Why:** overwriting it affects every concurrently-running test or demo session reading that value,
with no way to guarantee a safe, race-free restore.

**D:** `ENVIRONMENT BLOCKER` — shared singleton config, not a per-resource write.

**E:** would need a dedicated, isolated environment where no other process reads this value, which
this bench does not have.

### `saveEnquiryDetails` / `saveUnsubscriberDetails` (public record write)

**What:** persist a real CRM-style enquiry/unsubscribe record.

**Why:** no delete/cleanup endpoint exists anywhere in this bench's 391-endpoint registry for either
record type — confirmed by grep, not assumed.

**D:** `TEMPORARY` — this is a testability gap, not an architectural one; it is specifically blocked
on an external dependency (a delete endpoint that doesn't exist on the backend).

**E:** the backend would need to add a delete/cleanup endpoint for enquiry and unsubscriber records,
or the owner would need to confirm writing a real, permanent, un-cleanable record is acceptable for
test purposes (it is not, by default, in a shared environment).

### 11 writes blocked by the bench's own `sideEffect: 'global'` production wall

(`addingUserByAdmin`, `createOrRemoveBackupAdmin`, `resetPassword`, `terminateUser`,
`removeCompanyLogo`, `updateCompanyLogo`, `updateCompanyDetails`, `updateBankAccountDetails`,
`profile/changePassword`, `signupLogin/setAccessCode`, `signupLogin/userLogoutFromAllDevices`)

**What:** the `/admin/*`/`/v2/admin/*` company-admin ops (add/remove a member, reset their password,
change company-wide details/logo/bank info) plus three account-credential ops
(`changePassword`/`setAccessCode`/`userLogoutFromAllDevices`).

**Investigation history (so the correction is visible, not just the conclusion):** these were first
filed as a single "no admin auth available" block — wrong, since `business-m`/`business-s`/
`business-l` already authenticate via the ordinary login flow with a working `COMPANY_ADMIN` token
(confirmed live 2026-09-15). That led to writing `tests/api/kpost/admin/member-lifecycle.spec.ts` — a
full throwaway-member create→backup-admin-toggle→reset-password→terminate flow, with the real
`addingUserByAdmin` payload traced from `UserManagement.js:319-349` (including the `kpostID` domain
rule: `admin.contactID.replace(/^[^.]*\./, '')`) and the admin's own country/state/companyName
confirmed live via `profile-user-profile-by-kpostid`. **Running it found the real, final blocker**:
`ProductionSafetyError: ... not cleared for the live application`. Reading
`src/validation-engine/production-guard.ts` directly (lines 162-269) shows why, precisely:

    const liveWriteAuthorized =
      isLive && flags.allowLiveWrite === true && endpoint.destructive === true &&
      (endpoint.sideEffect ?? 'data') === 'data';   // 'global' never qualifies, by design

    // off live: `ALLOW_DESTRUCTIVE_TESTS` is refused outright on the live application
    if (sideEffect !== 'data' && !otpTestAuthorized) return blocked;  // on live (isLive branch)

The guard's own comment names the exact reasoning: *"on production the flag grants nothing... the
endpoints it unlocks are precisely the ones that must never run unattended —
`forgotPasswordUpdate`, `removeCompanyLogo`, `updateFlutterAppVersion`"* — this bench's architects
already deliberately covered exactly this case. All 11 endpoints above declare
`sideEffect: 'global'` in their own definitions (confirmed individually, not assumed from the
pattern) — there is no environment variable, no per-call option, and no amount of careful
throwaway-resource scoping that unlocks a `global` write against `TEST_ENV=production`. This is not
a gap in the bench; it is the bench correctly refusing to do the one thing that could take down a
shared production environment for everyone.

**D:** `PERMANENT on this environment.` Not a testability gap, not "buildable with more care" — a
deliberate architectural wall that only a genuinely separate non-production/staging environment
could lift.

**E:** a non-production environment for the `kpost-api` suite (`TEST_ENV` something other than
`production`) with its own company/admin accounts. Until one exists, these 11 endpoints stay
contract-validated off-live only, by design, exactly as the bench's own architecture intends.
`member-lifecycle.spec.ts` stays written (ready to run the instant a staging environment exists) but
unconditionally blocked by this check on the current environment — not by its own `test.skip`.

### `getMailCredentials` (KMail credential disclosure) — doubly blocked

**What:** returns an account's KMail send-credentials (host/port/password) if the supplied
`{kpostID, password}` matches that account's stored `kmailPassword` — read directly from
`SentMailServiceImpl.getMailCredentials` (`Kpost_Kmail_5.0`). The lookup is keyed on the `kpostID` in
the request body, never the caller's authenticated identity — a structural authorization gap,
confirmed from source, independent of whatever the real password turns out to be.

**Why blocked:** this endpoint is ALSO `sideEffect: 'global'` (confirmed in `manage.api.ts`) — it
would be refused by the same production-guard wall as the 11 above, regardless of anything else.
Separately and additionally, this session's own safety classifier independently refused the one
attempt made to run `tests/api/kmail/credential-disclosure.spec.ts` ("Credential Exploration").

**D:** `PERMANENT on this environment` (the production-guard wall), plus a standing session-level
pause on top of that.

**E:** same as the bucket above — a non-production environment — AND explicit authorization before
ever attempting a live credential-comparison probe, even on a future staging environment.

### TAWallet real-money form submission / `blockTicket` / KBooking `bookticket` family / dead `postBoxContacts`

Each has its own distinct, specific reason already given in its table row and inline comments in
`kbooking.api.ts` / `read.api.ts` — not repeated here since each is already a one-off, not a shared
category. Summary: two need explicit payment/booking-sandbox authorization from an owner (same
standing as Razorpay), two need an external party (the workbook owner) to add missing contract
documentation before this bench's generator will even accept the path.

---

## What changed in this rebuild (so the history isn't lost)

- **7 endpoints removed entirely** (no longer blocked at all): the "attachment file-upload" bucket
  (`katchup-download`, `katchup-download-thumbnail`, `katchup-media-streaming`,
  `katchup-generate-thumbnail`, `kmail-download-attachment`, `kmail-media-streaming`,
  `kmail-download-thumbnail`) was carried forward from an old, unconditional "needs a real uploaded
  attachment, nobody's built that" assumption. Both a Katchup presigned-upload lifecycle
  (`presigned-attachment-workflow.spec.ts`, 2026-09-26) and a KMail one (`attachment-idor.spec.ts`,
  2026-10-02) already exist and drive all of these live with a real uploaded file. The bench's own
  auto-generated classifier (`tests/framework/live-coverage.spec.ts`) was fixed today to stop
  special-casing these paths as permanently blocked.
- **KBooking reclassified from "whole module undecided" to "built, only payment blocked"**
  (2026-10-02) — confirmed frontend-active via a full source trace; see `UNUSED_ENDPOINTS.md` and
  `kbooking.api.ts` for the detail.
- **Admin company-admin writes: the premise "no admin auth available" was false, but the real reason
  is a HARDER wall than first thought.** Business-tier auth already works; a full throwaway-member
  lifecycle test was built and run; it surfaced that all 11 of these writes (plus `getMailCredentials`)
  are `sideEffect: 'global'`, which this bench's own `production-guard.ts` refuses unconditionally on
  `TEST_ENV=production` — correctly reclassified `PERMANENT on this environment`, not "buildable."
  `holdOrRelease`/`updateRole` were separately moved to `UNUSED_ENDPOINTS.md` (confirmed-incomplete
  frontend wiring — no modal ever consumes the open-flag their click handlers set).
- **This file's new total is 46** — not directly comparable to the old auto-generated list's count:
  7 stale "attachment" entries were removed, but this file also adds endpoints the old generated doc
  never covered at all (KBooking's `blockTicket`/`bookticket` family, the TAWallet rows, the dead
  `postBoxContacts` path, `getMailCredentials` moved here from "shared write"), while `holdOrRelease`/
  `updateRole` moved OUT to `UNUSED_ENDPOINTS.md`. Every row above carries a reason checked today, not
  inherited from the old list.
