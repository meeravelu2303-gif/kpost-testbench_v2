# API coverage depth — Phase 1 (existing-coverage audit)

Companion to `docs/COVERAGE.md`. That ledger answers "does a test exist for this endpoint?" (349/446
documented endpoints — 350 by direct registry count, off by one from a documentation-vs-registration
edge case not yet reconciled). This document answers the deeper question the coverage-depth audit was
asked for: **for a REGISTERED endpoint, does it get anything beyond the generic 50-auto-validator
sweep (auth, authz, request/negative-input, response/schema, security, common data-quality,
concurrency, performance), or does it also have a hand-written business-rule/functional-flow test?**
An endpoint can be "tested" per COVERAGE.md and still have zero assertions about what the endpoint is
*supposed to do* beyond "didn't crash, matched its schema, rejected garbage input, enforced auth."

**Do not assume a test existing means the endpoint is covered.** This document exists because that
assumption was checked and found false for just over half the registry.

## Cross-cutting audit: "reported fixed" is a claim, not a fact (2026-09-26)

Triggered by a user report that Kall's reschedule endpoint "doesn't handle its type/details
correctly." Live-checking it surfaced that a Bugzilla ticket the bench believed FIXED was not, and a
second believed INVALID was actually a real, still-reproducing defect — both because a test had been
switched from a pinned `test.fail()`/skip to a hard or trusted assertion on the strength of the
ticket's resolution, without a fresh live re-check first. That risk pattern was then searched for
across the whole suite (any test whose comment claims a bug "reported fixed" without describing a
dated, specific, freshly-observed behaviour) and every match was re-verified live. Findings:

| Ticket | Module / file | Believed | Actually found (2026-09-26) |
| --- | --- | --- | --- |
| #501 | Kall `reScheduleKall` | RESOLVED/INVALID | Reopened same-day on the belief it was "still broken" (creates a new `kallID`) — **then corrected back**: the owner confirmed a new `kallID` on reschedule IS the requirement. The original INVALID resolution was right all along; see the follow-up note below. |
| #500 | Kall `scheduledRepeatKall` | RESOLVED/FIXED | **Partially fixed** — the 500 crash is gone, but every repeat interval now 400s "Invalid Request" instead; a repeating call still cannot be created at all. Filed separately as #622 (4xx findings aren't auto-tracked). |
| #507 | Security `object-authorization.spec.ts` (BOLA) | RESOLVED/FIXED | **Still exploitable** — `removeGroupMember` lets an outsider remove a member from a group they don't belong to, confirmed at the database level. The other two attack paths in the same test (grant-self-admin, rename) ARE correctly denied. Reopened. |
| #499 | KOS `feature.spec.ts` (KWord lifecycle) | RESOLVED/FIXED | **Still broken** — `/kword/create` still fails to return a `docId`, so the entire downstream lifecycle still cannot run. A second file (`security/kword-object-authorization.spec.ts`) had already correctly assumed this was still open. Reopened. |
| #495 | Settings `notifications-workflow.spec.ts` | RESOLVED/FIXED | **Still broken** — the Katchup notification toggle reports success but never persists to the row. Reopened. |
| #497 | Signup-login `domain-policy.spec.ts` | RESOLVED/FIXED | **Genuinely fixed** — verified clean. |
| #498 | Profile `directory-lookup.spec.ts` | RESOLVED/FIXED | **Genuinely fixed** — verified clean (all 6 tests in the file pass). |
| — | Profile `profile-download-cover`'s 500→204 claim | (undated comment) | **Genuinely correct** — verified live, 204 with no body as claimed. |

**Two new self-inflicted duplicates found and resolved the same way as earlier this session**: adding
explicit filing (`recordBusinessRuleViolation`) to a finding that previously relied on an
unmonitored soft/hard assertion always mints a *new* Bugzilla fingerprint on its first run, even when
reopening the *original* ticket for the same fault in the same edit — #623 (dup of #507) and #624
(dup of #499) were both filed this way, then closed as duplicates pointing at the reopened original.

**A second, independent structural bug found while fixing these**: in three separate files this
session (Katchup, Admin, and now Settings), a test asserting a known, permanently-open regression was
sitting *mid-chain* in a `mode: 'serial'` describe block. Playwright's serial mode skips every later
test once *any* earlier one fails — soft assertions included — so each of these was silently
preventing a later, unrelated, otherwise-passing test from ever running. Fixed the same way each
time: move the known-failing assertion to the end of its serial chain (or make it independent of
shared state, when order itself mattered for something else).

**The lesson, applied going forward**: a Bugzilla resolution (`FIXED`/`INVALID`/`WONTFIX`) is a claim
someone made at a point in time, not a durable fact. Every place in this suite that encodes "X is
fixed" as a hard assertion or a skip condition should describe *what was actually observed, and
when* — a bare "#NNN reported fixed" comment is exactly the pattern that produced five wrong beliefs
in one afternoon, three of them about defects that were still live and, in one case, exploitable.

**Follow-up, same day — #501 correction reversed by the owner**: the owner confirmed that
`reScheduleKall` creating a NEW `kallID` on every reschedule is the actual, intended requirement —
"rescheduling" supersedes the original call with a fresh one, it does not update in place. Live-
verified against the database to see the full, correct picture: the original call's row moves
`senderKallStatus` 6 (Scheduled) → 7 (ReScheduled), correctly marking it superseded, while the new
call starts fresh at 6. The bench's test had been reading the WRONG row for the status check (the
API response's row, which is the new call and correctly stays at 6) — once that was fixed, both the
identity assertion and the status assertion pass cleanly. **#501, #620 and #621 all closed INVALID**
(their original 2026-09-22 resolutions were correct; this session's reopening of #501 was itself the
mistake, now reversed). `kall-reschedule`'s tests in `feature.spec.ts` now assert the corrected rule:
a new kallID is required and expected, and the ORIGINAL row is checked for the 6→7 transition rather
than the response's row. This doesn't overturn the "verify claims live" lesson above — if anything it
reinforces it in the other direction: a live re-check surfaced that the bench's own fix was itself
built on a misread of the requirement, and a second live re-check (this time checking the right row)
caught that too.

**Bench-tooling bug found while cleaning up #622's evidence**: `recordBusinessRuleViolation`'s
`request` field is what `buildCurl` (`src/bug-tracker/curl.ts`) turns into the ticket's reproduction
`curl` — and the `scheduledRepeatKall` finding had only been given `{ repeatType: 1 }` there, not the
full body actually sent. The ticket's auto-generated curl was therefore genuinely misleading: pasting
it reproduces a *different, correct* 400 ("scheduledStartTime is required") rather than the "Invalid
Request" the ticket is actually about — exactly the kind of wrong repro that gets a real defect closed
as "cannot reproduce". Fixed in `feature.spec.ts` (the full `scheduleShape()`-built body is now what
gets attached); a clarifying comment was added to #622 pointing at the corrected reproduction and
explicitly disclaiming the earlier truncated curls in the same thread.

**A second, smaller masking quirk found in the same evidence**: `buildCurl`'s masking
(`maskSecretsOnly`) is documented to keep identifiers (kpostIDs/emails) readable in a ticket's curl —
but `kallSession` still comes out fully masked (`"***"`) because its key name matches the generic
`/session/i` sensitive-key pattern in `src/utils/masking.ts`, even though a Kall session label is a
benign client-generated string, not a credential. `receiver` also appeared partially masked
(`h***@kpostindia.com`) in one ticket despite `maskSecretsOnly` not masking emails by design — the
exact mechanism wasn't fully traced (it likely originates in an earlier, stricter `maskSensitive` pass
over the captured exchange, e.g. `response-wrapper.ts`, before the value ever reaches `buildCurl`).
Neither breaks a ticket outright (a developer can still infer both values), but both work against this
tool's own stated goal of a copy-and-run reproduction. Worth a follow-up pass on the masking pipeline;
not fixed this session, flagged here so it isn't lost.

## Cross-cutting audit: "status < 300" is not "the field actually changed" (2026-09-26)

Direct follow-on to the audit above, at the user's request to go module by module. Scoped via four
parallel research passes across every module (kmail, profile, common, contacts, kdiary,
signup-login, group, kos, admin) for the same shape of gap Kall's reschedule had: an update/edit
endpoint whose test checks only the write's own status code (or, worse, only that it didn't 5xx),
never reading the record back to confirm the specific field actually changed. Every candidate found
was live-verified. Results:

| Endpoint | Module | Found | Fix |
| --- | --- | --- | --- |
| `kmail-sig-graphics/-style/-social/-template` | kmail | Readback existed but never compared field values | Genuinely works — strengthened the assertion to compare real markers |
| `kmail-edit-od-contact` | kmail | `contactName` wrongly guard-blocked as a resource id — the edit could only ever be a no-op back to the same owned address | Exempted in `qa-identifier-guard.ts`; no read endpoint exists to verify the name itself (structural limit, documented) |
| `profile-update-basic/-contact/-privacy` | profile | Status-only | Genuinely works (`knownLanguages`, `city`, `privacyDetails` all confirmed persisting) — strengthened |
| `profile-update-image` | profile | **Real defect**: rejects the bench's own PNG fixture ("Invalid File Format") while the identical bytes succeed on `uploadCoverImage`/`uploadImageToS3` | Filed **#626** [KP-6E793F], HIGH. Definition switched to JPEG so the lifecycle still runs |
| `profile-upload-attachments` | profile | **Bench bug**: wrong multipart field name (`file` instead of `files`) — had 400d every run | Fixed in `image.api.ts` |
| `profile-update-signature` | profile | 500s regardless of format | Already tracked, **#559** [KP-7D1F6B], CRITICAL — not new |
| `kdiary-update-remarks` | kdiary | Status-only | Genuinely works (`remarks`, `remarksDescription` both confirmed persisting) — strengthened |
| `contacts-update-invite` | contacts | Status-only | Structurally unverifiable — no read endpoint exposes invite status; documented, not worked around |
| `group-edit-name` | group | Status-only | Structurally unverifiable — no "get group details" read exists; documented |
| `group-update-image` | group | **Real bug, bench-side**: sent a plain JSON body to a multipart-only route — had 400d "Request must be multipart/form-data" on every single run in this bench's history | Fixed in `group.api.ts` (multipart, `file` part, JPEG — PNG also rejected here); the test now uploads for real and confirms non-empty content on download |
| `kos-update-doc` | kos | Status-only | Assertion added and ready, but **cannot be live-verified yet** — blocked transitively by #499 (`kword/create` still failing, see above) |
| `admin-workplace-tier-attribute-update`, `admin-hr-tier-attribute-update`, `admin-workplace-location-update`, `admin-employee-update` | admin | Status-only (unlike their sibling SAVE calls, which already cross-check) | Genuinely work — all 4 strengthened with a real before/after read comparison |

**Two more real, previously-hidden bugs found only because a genuine multipart upload was finally
attempted** (both endpoints had never once succeeded before, in either case): `profile-update-image`
and `group-update-image` share the same format restriction (PNG rejected, JPEG accepted) — worth a
developer question on whether PNG support is intentionally absent or itself a defect, since nothing
in either endpoint's naming or docs suggests "JPEG only."

## Resolved: the systemic ceiling on ~49 "needs-id" reads (`allowLiveRead`, added 2026-09-24)

While closing individual module gaps (dashboard, kos, group), the same architectural wall came up
three times: an Unknown/blocked "needs-id" read (`destructive: false`, no `productionSafe`) stayed
untestable on live **even when a lifecycle flow in the same test minted a real id for it**
(`group-download-image` after creating a real group+image; `kos-get-document` after creating a real
doc). The reason was in `src/validation-engine/production-guard.ts`'s `destructiveBlockReason()`:
its only live unlock, `allowLiveWrite`, was gated to `endpoint.destructive === true`
(`liveWriteAuthorized`/`writeFuzzAuthorized` both require it) — a non-destructive read had no
equivalent unlock at all, regardless of how the id was obtained.

A full registry sweep found **49 endpoints** (28 `kpost-api`, 14 `kmail-api`, 7 `admin-api` — about
14% of the whole registry) matching this exact shape — dependency-driven reads that Phase 4
explicitly asks for ("if an endpoint depends on another endpoint... create the required test flow
rather than testing it in isolation"): attachment/thumbnail downloads keyed by a uuid a sibling write
just minted, doc/session reads keyed by an id a create endpoint just returned, and similar.

**Fixed**, with owner sign-off, by adding `allowLiveRead` to `SafetyFlags`/`destructiveBlockReason()`
in `production-guard.ts` and threading it through `EndpointExecutor.SendOptions` — scoped exactly
like `allowLiveWrite`: `destructive !== true` (reads only) + `sideEffect: 'data'` only
(`external`/`global` and OTP still refused unconditionally), set per-call by an owner-approved feature
spec, never by the engine. Regression-tested in `tests/framework/live-safety.spec.ts` (unlocks a
needs-id read; does NOT unlock a write, a global-side-effect read, or an OTP-dependent endpoint).
Verified end to end on `dashboard-home-new-msgs` (fed a real marker from `homeDashboardMsgs`, live
200 in place of the documented null-marker 500) and `group-download-image`/`group-download-full-image`
(read back immediately after the same flow's `group-update-image`, live `GROUP_LIFECYCLE=true` run).

The remaining ~46 affected endpoints (mostly in `kmail`, `kpost/katchup`, `admin`, `kpost/kall`,
`kpost/kdiary`, `kpost/signup-login`) are not yet converted — the framework now supports it, but each
one still needs its own dependency-flow test written as that module is reached.

## Methodology

1. **Ground truth for "what's registered"**: the live `apiRegistry` (from `@api/definitions/index`),
   dumped via a throwaway Playwright spec, not regex over source files. An earlier regex-based pass
   undercounted `kmail` by 55 endpoints because `read.api.ts` defines endpoints through positional-
   argument factory helpers (`getRead(id, path, ...)`) rather than `defineKmailEndpoint({ id: '...' })`
   object literals — regex anchored on `id:` never saw them. Every one of the registry's 350 ids was
   then traced back to the exact definitions file that contains its literal (0 unmatched), so the
   module bucketing below is exact, not inferred.
2. **"API business-rule/flow tested"**: the endpoint's id literal appears in `tests/api/**` (filtered
   to files named `*feature*`, `*workflow*`, `*lifecycle*`, `*manage*`, `*security*`,
   `*domain-policy*`, `*login-flow*`, `*otp-*`, `*session*`, excluding the generic `coverage.spec.ts`/
   `read.spec.ts`) or anywhere in `tests/integration/**`.
3. **Deliberately excluded from "rich"**: `tests/framework/**` — those specs test the bench's own
   tooling (concurrency harness, validation engine, bug tracker), not product business rules, even
   though they reference real endpoint ids as fixtures.
4. **UI-only tests** (`tests/e2e/**`, `tests/e2e-admin/**`) were checked too: none of them reference
   endpoint id literals directly (they drive the page and assert screen/DB state), so they don't
   currently register as coverage for any specific endpoint id by this method. That's a gap in the
   *method*, not a claim that the UI specs assert nothing — it means this document cannot yet credit a
   UI-driven cross-layer check for a specific endpoint. This is also moot for now: UI test work is
   paused per current direction.
5. Raw per-module id lists are in `coverage-depth-raw.local.json` (git-ignored scratch — see cleanup
   note at the end).

## Summary

| Module | Registered | API-rich | Generic-only | Depth |
| --- | ---: | ---: | ---: | ---: |
| `kmail` | 70 | 67 | 3 | 96% ✅ done 2026-09-26 (3 recorded gaps, see below) |
| `kpost/profile` | 45 | 32 | 13 | 71% ✅ done 2026-09-24 (10 permanently by design, 3 real gaps) |
| `admin` | 38 | 33 | 5 | 87% ✅ done 2026-09-26 (5 genuinely blocked, see note) |
| `kpost/katchup` | 36 | 34 | 2 | 94% ✅ done 2026-09-26 (2 genuinely blocked, see note) |
| `kpost/common` | 33 | 28 | 5 | 85% ✅ done 2026-09-24 |
| `kpost/kall` | 20 | 20 | 0 | 100% ✅ done 2026-09-24 |
| `kpost/kos` | 18 | 17 | 1 | 94% ✅ done 2026-09-24 |
| `kpost/contacts` | 16 | 16 | 0 | 100% ✅ done 2026-09-24 |
| `kpost/signup-login` | 14 | 11 | 3 | 79% ✅ done 2026-09-24 |
| `kpost/kdiary` | 14 | 13 | 1 | 93% ✅ done 2026-09-24 (1 recorded gap) |
| `kpost/admin` | 12 | 0 | 12 | **0%** |
| `kpost/group` | 11 | 11 | 0 | 100% ✅ done 2026-09-24 |
| `kpost/settings` | 7 | 7 | 0 | 100% ✅ done 2026-09-24 |
| `kpost/aws` | 4 | 4 | 0 | 100% ✅ done 2026-09-24 |
| `kpost/dashboard` | 3 | 3 | 0 | 100% ✅ done 2026-09-24 |
| **Total (real KPost/KMail/Admin surface)** | **341** | **295** | **46** | **87%** |

**Excluded from the table above — bench-internal scaffolding, not KPost product endpoints**
(`users`, `auth`, `companies`, `dictionary`, `health` — 9 endpoints): every one of these carries
`mockFixture: true` in its definition. They run against the bench's own bundled mock server and exist
to test the VALIDATION ENGINE ITSELF (auth/authz/schema/negative-input machinery, the concurrency
harness, the bug-tracker pipeline) — `tests/framework/*.spec.ts`, `tests/integration/user-lifecycle.spec.ts`,
and the per-module contract-suite specs already exercise them for that purpose. There is no real
KPost backend behind `/users`, `/users/{id}` etc. to have a "business rule" about, so writing
product-style business-rule tests against them would assert nothing real. Originally miscounted as
part of the "KPost API" gap (see the corrected total above, which excludes them) — corrected
2026-09-24 before any work was done against them.

## Priority gaps (ordered by risk, for Phase 2–4 planning)

### 1. `kpost/admin` — 0/12, zero business-rule coverage
Business-tier admin actions with real state-mutation semantics (terminate user, reset password,
hold/release, backup-admin create/remove, role update, bank/company detail updates) — exactly the
class of endpoint Phase 4 calls out ("role-based behavior, permission rules, record ownership rules").
Currently only the generic 50-validator sweep runs against these.

```
admin-user-management-details, admin-bank-and-company-details, admin-kpostid-designation-suggestion,
admin-display-name-suggestion, admin-adding-user-by-admin, admin-terminate-user, admin-reset-password,
admin-hold-or-release, admin-create-remove-backup-admin, admin-update-company-details,
admin-update-bank-account, admin-update-role
```
Note: this module is `needs-business` per `docs/COVERAGE.md` (needs a business company with members)
— any Phase 2–4 work here needs that fixture data first.

### 2. `kpost/dashboard` — ✅ done (2026-09-24)
`tests/api/kpost/dashboard/feature.spec.ts`. `dashboard-home-msgs` and `dashboard-katchup-msg` are
live-verified: the batch's `firstMsgID`/`lastMsgID` ordering invariant, the `katchup` array's
newest-first ordering, and — the real cross-endpoint finding — that both endpoints report the
*identical* recent-activity window (same markers, same message ids) for the same account, so they are
one underlying query surfaced twice, not two independently-drifting reads. `dashboard-home-new-msgs`
could not be given a live business-rule test: it is `destructive: false` with no `productionSafe`
flag, and the engine's safety gate (`destructiveBlockReason`) only grants a live-write unlock
(`allowLiveWrite`) to `destructive: true` endpoints — there is no equivalent unlock for a
non-destructive "needs-id" read. Recorded as a skipped, explicitly-reasoned placeholder test rather
than worked around or left silently absent.

### 3. `kmail` — ✅ done (2026-09-26): 60→67/70, 3 recorded gaps

Originally went 15→60 rich (21%→86%) on 2026-09-24 across `feature.spec.ts`, `reads-workflow.spec.ts`,
`signature-letterhead-workflow.spec.ts`, `manage-workflow.spec.ts`. Revisited twice more on 2026-09-25
— once to close as many of the 10 recorded gaps as could honestly be closed, then again after the dev
pushed changes, to re-verify every open ticket and check for anything the update fixed.

- **Prerequisite finding**: `testkmail.kpostindia.com`'s long-standing 401-on-every-token regression
  (`auth-regression.spec.ts`, `KMAIL_AUTH_FIXED` gate) is fixed — verified live across 3 accounts
  before starting this module. `KMAIL_AUTH_FIXED=true` was already set in `.env`.
- Fixed a real, reproducible bug in the *existing* settings-writes test: it created a saluation and
  instant-reply every run and never deleted either, permanently accumulating junk on the shared QA
  account. Replaced with a unique-marker create→read-back→verify-on-digital-signature→delete flow.
- Fixed a real request-shape bug in the (gated, not-yet-run) `kmail-ai-assist`-adjacent
  `kmail-sig-full` test path and separately in the pre-existing kos AI test (see kos section above).
- **Two real, live-confirmed backend defects found and auto-filed**: `kmail-sig-full` 500s (not 400)
  when `companyData` is omitted; `kmail-unopened-count` 500s deterministically for every account
  (`SQLGrammarException: could not extract ResultSet`) — not a flake, reproduced across 2 accounts.

**3 of the original 10 gaps closed**:
- `kmail-sig-company` — `QA_COMPANY_NAME` is now set in `.env` to `Nebius Solutions`, confirmed live
  via `common-company-details` authenticated AS the `business-m` principal itself (co 242) — genuinely
  owner-confirmed via the account's own data, not invented. `saveOrUpdateMailSignatureCompanyData` now
  has a real, passing test (write → read back → assert exact match on `business-m`).
- `kmail-reference-content` — the identifier-guard half is fixed: `referencekmailid`/`referencemails`
  are now exempted as runtime-scoped KMail ids (the same class `kmailid`/`kallid` already were),
  verified against the guard's own 25-test regression suite. A real mail is now sent and its real
  `kmailID` fed to the endpoint live — but the exact request shape remains Unknown/Requires
  Clarification: every shape tried (`{referenceMails:[id]}` as number and string, `{referenceKmailID:
  id}`, `{kmailIDs:[id]}`, `{kmailIds:[id]}`, a raw `[id]` array body, and both as query params) 400s
  with a generic Spring deserialization failure. Recorded with a real id now available whenever the
  correct shape is confirmed — not worked around by guessing further.
- `kmail-download-thumbnail` / `kmail-media-streaming` / `kmail-download-attachment` — the HAPPY PATH
  is still blocked (see below), but nonexistent-uuid handling is now genuinely tested, live-verified
  across 3 fake uuids: `downloadAttachment`/`downloadThumbnail` answer 200 with an EMPTY body (should
  be 404); `mediaStreaming` crashes with 500 every time. Filed as **#604**, CRITICAL, KMail API.

**A dev update landed 2026-09-25 mid-session — re-verified every open ticket against it.** 5 were
genuinely fixed and closed: `#591` (`deleteKmailWithDeletedBy` now correctly 400s instead of 500 on
its original repro), `#582` (`replyNotReceived` now answers 200 with real data instead of 500 on a
null `kpostUser`), plus 3 auto-resolved by the engine's own verified-fix check during a routine full
run (`#374`, `#380`, `#600`). `postMail` still 415s a multipart request (attachments still cannot be
uploaded — the one documented upload route, `draftMailMultiPart`, still 404s) and `postBulkMail`/
`clearStatusOf*` still fail identically to before — the dev's update did not touch those paths.

**Two duplicate tickets found and merged during this re-verification — both this bench's own mistake,
worth recording so it isn't repeated**: while closing the `kmail-reply-not-req-receiver` and
`kmail-media-streaming` gaps, a docstring in `feature.spec.ts` (and one I wrote for the attachment
test) both assumed the engine's flow-finding pipeline only auto-files `allowLiveWrite`-authorized
5xxs, not `allowLiveRead`-authorized ones — **false**, confirmed by `admin-login-regression.spec.ts`
already working correctly the other way. Manually adding `recordBusinessRuleViolation` for a plain
5xx status check in both cases created a genuine duplicate ticket for a fault the pipeline was
already tracking on its own (`#603` duplicated `#583`; `#605` duplicated `#604`). Both duplicates
resolved with an explanatory comment and `dupe_of` set; the manual filing code was reverted in both
places. **Lesson applied going forward**: `recordBusinessRuleViolation` is only for a genuine
2xx-but-wrong-DATA finding the engine cannot see by status code alone (like the `countryID`
inconsistency or `kall-contactInfo`'s all-null envelope) — never for a plain "must not 5xx" check,
which the pipeline already covers regardless of which live-authorization flag unlocked the call.
Audited every other `recordBusinessRuleViolation` call added this session against this rule; none of
the others (company-workflow's countryID check, kall-reads-workflow's contactInfo check) share this
mistake.

**A second, older duplicate pair found while auditing tickets predating this session**: `#584`/`#585`
each exactly duplicated `#383`/`#384` (same endpoint, same classification, same error) — filed 5 days
apart under different dedupe tags because the bench's own report-message template changed between
those dates, shifting the fingerprint hash for the same underlying fault. Not an ongoing dedupe bug
(today's re-runs matched correctly); both newer duplicates resolved, pointing at the older tickets.

**Dev answered 4 of the original open questions on 2026-09-26 — 2 gaps closed for real, 2 reclassified**:
- **`kmail-post-bulk` (`postBulkMail`) — closed, genuinely fixed.** The dev supplied a working curl
  showing `postBulkMail` is NOT `postMail`'s shape plus `toAddressList` — it has its own small, distinct
  contract: `{toAddressList, kmailSubject, kmailContent, priority, kmailType: 13 (bulkmail),
  attachmentUuid: []}`. Spreading the full `mailShape()` in (saluation, groupFlag,
  senderLatitde/Longitude, forwardList, …) is what caused the previous bare 400 with no detail — none of
  those fields belong here. Fixed in the endpoint definition (`send.api.ts`) and live-verified against
  `testkmail.kpostindia.com`: 202 `"Bulk PostMail Send SuccessFully"` to both an internal `.kpost.in`
  address and an external address; sending to the caller's own address correctly 400s "Receiver Cannot
  be same as sender" (sensible validation, not a defect). `manage-workflow.spec.ts`'s `postBulkMail`
  test rewritten around the correct shape and passes live.
- **`kmail-bulk-status` — closed as a direct consequence, was never actually blocked.** It had been
  recorded as blocked transitively on `postBulkMail`'s "Unknown/Requires Clarification" shape, but
  `GET /sentMail/bulkMail/status/{fromAddress}` only needs the CALLER's own address
  (`testData.kpostId`), not any id `postBulkMail`'s response would need to mint (it returns none).
  Live-verified 2026-09-26 right after a real bulk send: `{"total":1,"status":"PROCESSING",...}`. Folded
  into the `postBulkMail` test rather than kept as a separate skip.
- **`kmail-postbox-contacts` / `kmail-draft-multipart` — reclassified, not closed.** Dev-confirmed:
  "Api's are not in use." These are intentionally unavailable on this build, not a deployment gap
  waiting to be filled — consistent with the plain Spring 404 both routes return. Still generic-only
  (there is no business rule to test on a route that will never be called), but no longer an open
  question blocking further work; recorded as permanent by-design exclusions.

**Dev answered questions 3 and 4 on 2026-09-26 too — both narrowed the problem instead of closing it**:
- **Question 3, `clearStatusOfKmailsContacts` / `clearStatusOfAllKmailsContacts`** — dev said the
  original 500 "was fixed by using some custom annotations." Re-tested live the same day: only PARTLY
  true. `selectedContact` alone (the old default body) still 500s
  `{"errorCode":"clear mails exception occured",...}`; adding a `kmailStatusFlag` field (tried as int
  0-4, `"0"` as a string, and enum-name strings `"REPLY_SENT"`/`"REPLY_NOT_SENT"`) avoids the crash and
  gets a clean 400 `{"valueFor":"REPLY_NOT_SENT","message":"Parameter Invalid"}` instead — so the
  annotation fix only covers the field-present case, not its absence. More importantly: no value of
  `kmailStatusFlag` ever satisfies `REPLY_NOT_SENT`, live-verified even across a real send-then-reply
  exchange between the two test accounts (A sends to B, B genuinely replies to A, then A calls
  clear-status for B) — identical error, unchanged by the reply actually existing. That result makes
  `kmailStatusFlag` look like the wrong field name (its presence avoiding the crash may just be dodging
  a null-check elsewhere, not actually being read). Endpoint definitions and the manage-workflow test
  updated to reflect this sharper diagnosis; still tracked as one open ticket (auto-commented, not
  re-filed) rather than closed. **What's still needed from the dev**: the exact field name/type the
  validation checks, and what account/mail state `REPLY_NOT_SENT` is actually testing for.
- **Question 4, `kmail-delete-letterhead`** — dev confirmed: letterhead id "1" is the shared system
  default; "other[s] are should be added by user for their own customization." This matches the
  evidence already on file and resolves the ownership question — id 1 is confirmed unsafe to delete,
  not merely suspected. But it surfaces a narrower, still-open gap: the KMail OpenAPI contract and
  workbook register only get-all/get-current/get-template/set-active-by-id/delete-by-id for
  letterheads — no create/save/upload route is documented anywhere for the "add your own" flow the dev
  described. **What's still needed from the dev**: which endpoint that flow actually calls, so this
  bench can create a personal letterhead and safely test delete against that instead of the shared
  default.
- `kmail-credentials` — sensitive (returns account credentials), deliberately not driven on live; a
  policy decision, not something further investigation changes.

**What it would take to close the remaining 3**: one more specific answer each for questions 3 and 4
(above), and nothing further for `kmail-credentials` (a permanent policy exclusion, not an open
question). `postbox-contacts` and `draft-multipart` are also permanent by-design exclusions now, not
open questions.

### 4. `kpost/common` — ✅ done (2026-09-24): 6→28/33
**Methodology correction first**: the original 6/33 estimate was itself measured wrong. This
module's 6 OTP endpoints (`common-send-otp`, `common-validate-otp`, etc.) are richly tested — just
from `tests/api/kpost/signup-login/otp-signup-lifecycle.spec.ts`, not from within `common`'s own
test directory. The per-module audit script only searched each module's own folder for rich-file
matches, missing legitimate cross-module coverage. Fixed by searching the whole `tests/api` tree
for every module from here on; worth a retroactive spot-check on earlier "done" modules if time
allows, since the same blind spot could apply anywhere a business flow lives in a sibling module.

Highlights of the real 0-business-rule-tests gap found underneath that correction (still 27
generic-only once OTP was properly counted, confirming Phase 1's original instinct that this module
needed real duplicate-prevention testing):

- `common-mobile-no-exist` (and its in-company sibling) asked with BOTH a known-absent and a
  known-existing number — the actual true/false duplicate-detection logic verified, not assumed.
- **Real cross-endpoint data-consistency defect found and filed**: `getCompanyDetails`,
  `getCompanyDetailsByAdmin` and `getCompanyDetailsByMobileNoAndproductId` all answer the identical
  underlying question (which company does this mobile number belong to) and agree on `companyID` —
  but disagree on `countryID` (1 vs 0) for the exact same company in the same run. Filed as **#595**
  and **#596** (HIGH) via `recordBusinessRuleViolation`, since it's a 2xx-but-inconsistent-data
  defect the engine's own validators cannot see.
- **Real defect found and auto-filed** (deduped to an existing tracked ticket):
  `common-save-enquiry-details` 500s deterministically (`ConstraintViolationException`) on its own
  fully documented default payload — reproduced twice.
- Two more `qa-identifier-guard.ts` false-positive fixes, same class as `searchMessage` earlier:
  `maximummemberscount` (a capacity number, not a member id) — both verified against the guard's own
  25-test regression suite before and after.
- **5 recorded gaps**, all deliberately excluded by design, not workarounds: the company-logo trio
  (`COMPANY_ADMIN`-gated, and the endpoint definitions' own extensive prior investigation already
  declined to upload a real logo on a reference-only token without explicit authorization),
  `common-update-flutter-app-version` (`sideEffect: 'global'`, controls every mobile client's
  install prompt), and `common-save-unsubscriber-details` (404, route not deployed on this build).

### 5. `kpost/profile` — ✅ done (2026-09-24): 32/45, 13 recorded gaps
Went from 18→32 rich (40%→71%) across `feature.spec.ts`, `reads-workflow.spec.ts`,
`device-workflow.spec.ts`. Highlights:

- **User-reported workbook correction (fixed at the source, not worked around)**: the user directly
  confirmed `GET /v2/profile/fetchUserDetails/` takes NO payload — token only — while the workbook
  documented POST with `{kpostID, countryID}`. Traced to `KPOST API (6).xlsx`, KatchupAPI!L2 (a
  literal `"GET METHOD"` cell, matching the workbook's own established convention, replaces the
  wrong payload). While fixing it, found the SAME payload was also bleeding into
  `/v2/profile/fetchUserDetails/` from a second, unrelated row (K3) that combines two different
  service URLs in one cell — split out, confirmed against the real, working
  `signup-login-fetch-user-details` (`POST /v2/signupLogin/fetchUserDetails/`) definition that the
  payload actually belongs to. Contract regenerated (`npm run contract:excel`); the phantom
  `POST /v2/profile/fetchUserDetails/` OpenAPI operation is gone. Every other cell in the 8-sheet
  workbook verified byte-identical before promoting the fix (diffed old vs. new programmatically).
  This also retroactively explains a 500 ("A valid kpostID and countryID is required") found earlier
  this session and originally logged as a possible new backend regression — it wasn't one; it was
  the endpoint definition's now-removed `contractMethod: 'POST'` override, downstream of the same
  wrong workbook data.
- **Real, previously-silent bug found and fixed**: the existing "education record" test read
  `collegeDetails` from `getUserProfileUsingKpostID`'s response as if it were an array to search for
  the just-saved record's id — but that field is a JSON-encoded **string** (`collegeDetailsAsJson` is
  the actual parsed array). `Array.isArray(string)` is always false, so the id was always
  `undefined` and `profile-delete-college` was **never actually reached** — a passing test that
  never exercised its own cleanup step. Fixed, and confirmed by the cleanup it had been silently
  skipping: **25 leftover "QA Bench College" records** had accumulated on the shared QA account
  across however many prior runs; all deleted once the fix let the delete path run for real.
- Fixed the same "empty string flagged as an unowned identifier" issue found earlier with KMail
  (`kmail-sig-full`/`kmail-add-od-contact`) in `profile-advanced-search`'s own endpoint definition —
  `mobileNumber: ''` was blocking ANY live run of this productionSafe-flagged endpoint outright.
- Retired a stale finding: `profile-get-languages`'s definition claimed "GET→405, POST→500, no
  working verb works" — re-verified twice live, both verbs now answer 200. What's still real and
  now asserted: the language list itself is empty (`data: []`), recorded as Unknown/Requires
  Clarification rather than a defect.
- **Recorded gaps (13, each with an explicit skipped test and reason)**: 10 are **permanently
  architecturally excluded by design**, not real gaps — OTP senders (SMS kill-switch),
  session-destroyers (`setDeviceAs*`/`updateDeviceAs*`, blocked even on a confirmed OTP test
  gateway), and global credential/account changes (`changePassword`, `deactivateAccount`, would
  lock the suite out of its own QA account mid-run). The remaining 3 are real, closable gaps:
  `profile-save-other-activity` has no matching delete endpoint anywhere in the module (saving a
  real record live would permanently pollute the account, the same class of bug just fixed for
  KMail's saluation/instant-reply leak); `profile-save-experience`/`profile-delete-experience` need
  `QA_COMPANY_NAME` configured in `.env` (only `QA_COMPANY_NAME_ABSENT` exists today) — same
  unconfigured-identity-field gap as `kmail-sig-company`.

### 6. `kpost/katchup` — ✅ done (2026-09-26): 15→34/36 (94%)

**Root cause of the 2026-09-24 blocker, found and fixed**: the developer flagged that `groupFlag`
must be a boolean, not the `'N'`/`'Y'` char convention `sendShape()` used. Live investigation found
neither is right: `groupFlag` is a **String-typed field spelled as the word `"false"`/`"true"`** — a
real JSON boolean 400s identically to the old char convention. Fixed in `send.api.ts`; this single
change fixed `katchup-send-message` (**Bug #594 resolved**) AND cascaded to `katchup-send-multipart`
(embeds `sendShape()` in its `text` field) AND `katchup-save-messages`/the group-send path in
`feature.spec.ts` (same String convention, found live once sends worked again and those calls still
400s). `katchup-mark-important`/`-recall-message`/`-delete-message` all accept a real boolean fine —
the String requirement is per-endpoint, not module-wide; each is commented where fixed.

That fix unblocked everything the module needed a real sent message for:

- **Shared/reference reads** (`katchup-bulk-message-info`, `-reference-details`,
  `-messages-by-reference`, `-shared-message-info`, `-shared-message-details`): the "no id-minting
  endpoint" theory from 2026-09-24 was wrong — every ordinary `sendMessage` response already carries
  a `sharedMessageId`, no separate "share" action needed. `getBulkMessageInfo`/`getReferenceMSGDetails`
  confirmed working (200, real data); `getSharedMessageInfo`/`getSharedMessageDetails` both crash
  (500) on a real id — filed as **#612**/**#613**, both CRITICAL, KPost API.
  See `shared-reference-workflow.spec.ts`.
- `katchup-send-multipart` now succeeds but never actually attaches the uploaded file
  (`attachmentUuid: null`, both immediately and on readback) — filed as **#614** [KP-90586F], HIGH.
  **Owner-confirmed 2026-09-26: this route is legacy, not used by the current client** — the real
  production flow uploads via a presigned S3 URL instead (see below). #614 closed **WONTFIX**; the
  route stays registered but is no longer asserted on live. See `attachment-workflow.spec.ts`.
- **The real attachment flow, found and driven live for the first time 2026-09-26**: generate a
  presigned S3 URL (`aws-katchup-presigned`), PUT the file directly to S3 with it, then send an
  ordinary `katchup-send-message` whose `uuid[]` names the upload. Confirmed working correctly —
  `attachmentUuid` comes back set, `attachmentCaptionDetails` is populated. This minted the real
  attachment uuid the six download/streaming reads needed, unblocking all of them:
  `katchup-download-from-s3`, `-download-thumbnail`, `-media-streaming` and `-generate-thumbnail` all
  confirmed working; two real defects found on the other two — `katchup-download` serves the exact
  right bytes but a **hardcoded `Content-Type: image/jpeg`** regardless of the real file type (filed
  **#617** [KP-CBBC90], HIGH), and `katchup-download-attachment`'s presigned GET URL hardcodes its
  ASCII `Content-Disposition` filename fallback to **`"file.xlsx"`** for every attachment, reproduced
  with two different real file names (filed **#618** [KP-2CAEB3], HIGH). See
  `presigned-attachment-workflow.spec.ts`.
- `recallMessage` answers 200 "success" for a real message but leaves both `deleted_by_sender` and
  `deleted_by_receiver` DB flags at 0 — a false success, confirmed by a direct MySQL check. Filed as
  **#610** [KP-80AC38], HIGH. See `workflow-db.spec.ts`.
- An empty `subject` is stored as sent (200), answering the open question in `docs/katchup-flow.md`
  §6 Q1. Initially filed as **#615** [KP-9DD851] on the assumption Subject was mandatory; the owner
  then amended FR-K02/BR-K01 (2026-09-25) — Subject is no longer required, so this is the correct,
  intended behaviour. **#615 closed as INVALID**; `lifecycle.spec.ts` now asserts acceptance instead
  of flagging a violation.
- `katchup-forward-message-new` consistently 500s on a real msgID — already tracked as pre-existing
  **#611** [KP-A082D1]; not a new finding, confirmed still open.

**Two structural test-authoring bugs, unrelated to `groupFlag`, found and fixed while re-verifying
the whole module**:
- `lifecycle.spec.ts`'s entire suite could never run at all, at any point in this bench's history —
  its own `send()` helper never set `allowLiveWrite: true`, so every call threw
  `ProductionSafetyError` before the `groupFlag` bug was even reachable. Its delete calls also used
  the wrong field (`msgID` singular; the live client's own field is `messageIds`, an array — same
  bug independently found in `workflow-db.spec.ts`'s delete test, also fixed).
- Both `lifecycle.spec.ts` and `workflow-db.spec.ts` run their tests `mode: 'serial'` (required: the
  project is `fullyParallel`, so shared state across tests in one file needs the same worker) — and
  Playwright's serial mode skips every later test once **any** earlier one fails, soft assertions
  included. A test asserting a known, permanently-open regression (#610; originally also #615, before
  that one was closed as invalid — see above) was sitting mid-chain
  in both files, silently preventing later, otherwise-passing tests from ever running (`workflow-db`'s
  "delete: soft-deleted, not removed" test had never once executed). Fixed by reordering each
  known-failing assertion to the end of its serial chain (or, for `workflow-db`'s delete test, making
  it independent of the shared `msgId` entirely, since order still mattered for `recall`'s own setup).

**Final state**: 34/36 (94%). The 2 remaining generic endpoints are genuinely blocked, not
under-tested — `katchup-messages-subject` (404, route not deployed on this build) and
`katchup-send-multipart` (legacy route, superseded by the presigned-URL flow, #614 closed WONTFIX) —
both recorded with their specific reason in `needs-id-workflow.spec.ts`/`attachment-workflow.spec.ts`,
not worked around with a fabricated id.

<details>
<summary>History (2026-09-24 investigation, before the fix)</summary>

Highlights before the blocker hit:

- Added `searchmessage` to `qa-identifier-guard.ts`'s `NOT_A_RESOURCE` — the exact same class of
  false positive as `actualmessage`/`kmailcontent` already exempted there (a free-text search query,
  not a record identifier), confirmed against the guard's own regression suite (25/25 still pass).
- `katchup-forward-backtrack` wired to a real forwarded msgID from the existing
  `katchup-forward-message-new` call in the "send variants" test (previously only asserted "doesn't
  5xx"; now the id it returns is captured and fed forward via `allowLiveRead`).
- 7 plain reads (`katchup-unopened-count`, `-unopened-total-count`, `-frequent-contacts`,
  `-message-count`, `-search-subject`, `-filter-message`, `-all-report-msg`) given real
  business-rule assertions, including a genuine cross-check (`getUnopenedMessagesCount`'s
  `msgsCount` is asserted to equal the sum of its own `resultList` entries — the field would be an
  easy one to silently break by summing the wrong column).
- **Two live, currently-reproducing findings, not confidently one endpoint's own bug**:
  `katchup-search-message` and `katchup-filter-message` both time out well past 10s (retried at
  20s/25s, consistently) — soft-asserted so they're reported rather than blocking the file, left for
  the engine's own 3-pass reproduction gate to judge rather than hand-classified as a single
  endpoint's defect, since the same intermittency also hit `katchup-unopened-total-count` once.

**Then blocked**: mid-session, `katchup-send-message` — the single most basic, most-depended-on
write in the entire module, unchanged from its long-working default shape — started answering 400
`{"data":[],"status":"FAILURE"}` with no diagnosable message. Verified this is not something this
session's changes caused: reproduced with the endpoint's pure, zero-override default payload, from
two different accounts. This blocks every remaining needs-message-id/needs-attachment endpoint in
the module (they all need a fresh send to chain from). Since this is a 4xx (not 5xx), the engine's
automatic write-flow filing doesn't pick it up by design (see `flow-finding.ts`) — filed manually via
`recordBusinessRuleViolation` in a new, permanent, ungated `send-regression.spec.ts` (mirroring
KMail's own `auth-regression.spec.ts`), which reproduced it cleanly and filed **Bug #594 [KP-4EB0BB]
(HIGH, KPost API)**. That spec stays in the suite and will show green the moment the fix lands,
signalling the rest of the `KATCHUP_LIFECYCLE` suite is safe to trust again. The 12 still-generic
endpoints are recorded as explicit gaps in `needs-id-workflow.spec.ts`, each citing its specific
blocker (this outage, a 404-undeployed-route, or "no id-minting endpoint found" for the
share/reference reads) — not worked around with a fabricated id. **Module resumes once sends work
again.**

**Confidence downgraded 2026-09-24**: a user-captured payload sent to the LIVE application
(`devapi2.kpostindia.com`) succeeded with an equivalent shape. This bench targets
`testingapi.kpostindia.com` — a separate, disposable test-DB environment — for every send. Re-ran
the exact devapi2-captured shape against testingapi (including `groupFlag` as a boolean and
`actualMessage` as the real Quill-Delta JSON string, neither of which `sendShape()`'s default uses);
still 400, from a different receiver and from a self-send alike, with both QA accounts resolving
normally on testingapi via other reads. So the 400 is confirmed on testingapi specifically, not on
devapi2/production. #594 was amended with this finding so it isn't chased as a production issue; see
`send-regression.spec.ts`'s updated docstring for the full trail.

</details>

### 7. `kpost/signup-login` — ✅ done (2026-09-24): 4→11/14

**A confirmed CRITICAL regression found and filed**: `adminUserLogin`'s own definition documented a
prior investigation (BUSINESS_M/L → 200, BUSINESS_S → 403 "Not A Admin"). Live-verified again: ALL
THREE tiers now answer `500 "Unexpected error occurred"` — reproduced twice with the endpoint's own
default payload. Every medium/large business admin is locked out of the admin login gateway, not
just the small-tier one the tier check intentionally excludes. Filed as **#598** [KP-A04E2F],
CRITICAL, and kept red permanently by `admin-login-regression.spec.ts` (same pattern as `katchup`'s
`send-regression.spec.ts`), so it re-files/re-confirms every run until fixed.

**Two of the module's own definitions were stale, corrected during this pass**:
- `generateJWTokens`'s comment claimed testingapi's login "does not expose a `refreshToken` where the
  chain can read it". False — it does, but only on a login that runs on its own device id, not the
  shared cached session every other test reuses (a different device's token). Once driven from a
  dedicated login, the endpoint is fully testable and turned out to enforce a real, undocumented
  business rule: **redeeming a refresh token is session-scoped** — it succeeds only when the caller
  is authorized with THAT SAME login's own access token, and is refused (401) when authorized with a
  *different*, even currently-valid, session of the same account. `auth-profile.ts`'s comment on the
  `business-m` principal also asserted `adminUserLogin answers 403` for it — superseded by the #598
  regression above; both comments now point at the current, live-verified reality.

**Methodology note carried over from `common`**: logging in again for an account invalidates that
account's previous session immediately, server-side — confirmed by watching the shared cached
principal's token 401 on its very next call after an unrelated fresh login on a brand-new device.
The engine's token cache only re-logs-in once a cached JWT's own expiry passes, so it has no way to
detect an early server-side invalidation; poisoning the shared token would 401 every later test in
the run (`workers: 1`, one cache per worker). The two tests here that need a second login run it
against `personal-5`, a configured-but-otherwise-unreferenced principal, authorized by its own
literal token rather than through the engine's cache — so nothing shared is ever touched.

**3 recorded gaps**, all deliberately excluded by design: `signup-login-admin-registration`
(OTP-dependent, `sideEffect: 'global'`, creates an unreleasable company tenant, and no reserved
identity is configured for it — reusing the personal-signup identity risks collision), and
`signup-login-logout-all-devices` / `signup-login-set-access-code` (both `sideEffect: 'global'` —
ending every session or rewriting a live credential with no way to restore it), matching the
declines already documented on each endpoint's own definition.

### 8. `kpost/contacts` — ✅ done (2026-09-24): 9→16/16

**A stale default request fixed, not a product bug**: `getSearchDetails`'s own default payload asked
for `requestType: 'areaName'` with `provienceName`/`state`/`city` all empty, on the assumption
(recorded in its own comment) that an area lookup ignores those fields. Live-verified: it does not —
the server 400s that with "Missing required fields for requestType 'areaName'", so the endpoint's
own baseline call always failed every run (already visible as a `response.status-code` failure in
the generic suite, filed nowhere since it's a config/contract gap, not a product defect). Traced the
REAL cascade: `country` -> `provienceName` (a ZONE, e.g. "Southern Zone", not a state) -> `state` ->
`city` -> `areaName`, each level requiring the ones above it populated. Fixed the default in
`read.api.ts` (now `provienceName`, the only level valid with just `country`) and drove the full
chain end to end in `contacts-reference-workflow.spec.ts`, confirming the baseline check now passes.

**Real business-rule tests added**:
- `globalSearch` verified to enforce every filter it is given (`userTypeList`, `countryList`), not
  just the free-text search term — checked across all 534 results for a broad query, zero violations.
- `myUnknownKatchupContacts`, `myGroups`, `myUnknownGroups`, `getImportedPhoneContacts` — ownership
  (every row belongs to the caller) and no-duplicate-row data-quality checks, all clean on live data.
- `contacts-block` → `getBlockContactDetails` → unblock, a clean cross-endpoint chain: blocking makes
  the contact appear in the block list, unblocking removes it, restoring state afterward.

**Deliberately NOT re-tested**: whether `myContacts` still lists a contact after `deleteContact`
reports success — that exact failure mode (delete reports success but leaves the row live,
`delete_status` unmoved) is already covered precisely, against the raw DB flag, by the existing
`contacts-workflow.spec.ts`. Confirmed live while investigating this module (a controlled delete
still left the account in `myContacts`) — not a new finding, so not re-filed.

### 9. `kpost/kall` — ✅ done (2026-09-24): 14→20/20

**Confirmed defect: `contactInfo` never resolves real data.** `POST /v2/kall/contactInfo/` returns an
envelope of all-null/empty fields (`{"kpostID":null,"contactID":null,"firstName":null,…}`, HTTP 200
"SUCCESS") for every input tried in the same test: a real, restored (non-deleted), actively-in-call
contact, the caller's own account, `kallID: null`, and a real `kallID` from a call placed seconds
earlier. `kallDashboard` and `kallInfo`, queried for the exact same call in the same test, correctly
return full details — the data exists and other reads see it; `contactInfo` alone never does. Filed
via `recordBusinessRuleViolation` as **#599** [KP-FC6594], HIGH, KPost API.

**Real cross-endpoint chains added** for all 6 previously generic-only reads: a placed call surfaces
in `kallDashboard` and `kallInfo` (matching `kallID`); a call scheduled for later today surfaces in
`todayKoolKall`; a repeating call surfaces in `fetchScheduledRepeatKall` from its start date;
`frequentKallContacts` checked for well-formed, non-duplicated rows; `kallInfo` confirmed to report
no rows (not a crash or leak) for a contact with no call history.

**Investigation note**: two full-module live runs were accidentally launched concurrently against the
same account during this pass. They interfered with each other (one run's cleanup step raced the
other's in-flight call), producing inconsistent results — the `contactInfo` finding above and the
pre-existing `BR-C01` reschedule issue each looked different across the two runs. Neither concurrent
run's output was trusted; a clean, isolated re-run confirmed the `contactInfo` finding reproduces
reliably and everything else in the module is unaffected.

**2026-09-26: re-audited `reScheduleKall`/`scheduledRepeatKall` at the user's request, on the theory
that "reschedule doesn't handle its type/details correctly" — confirmed, and worse than the bench's
own records showed.** Two tickets the bench believed were resolved were not:

- **#501** was closed **RESOLVED/INVALID** on 2026-09-22 — but reschedule still creates a brand-new
  `kallID` instead of updating the original, reproduced twice, deterministically, in the same session.
  The bench's own test had been switched from a pinned `test.fail()` to a hard `expect()` on the
  belief the fix had landed, without re-verifying live first — a bench-side mistake. **#501 reopened**
  with the fresh evidence, and the test is soft + explicitly filed again, permanently, rather than
  ever assuming "fixed" without a live check.
- **Two more sub-findings under the same reschedule call, previously only logged as inert
  "observed" annotations, never asserted or filed**: `senderKallStatus` never moves from Scheduled
  (6) to ReScheduled (7) on either row (filed **#621** [KP-087A98], HIGH); the new row reschedule
  creates has `parent_kall_id: null` instead of pointing back at the original, making the duplicate
  untraceable (filed **#620** [KP-8315CB], HIGH).
- **A new permanent test for a fourth, previously-unrecorded reschedule finding**: an incomplete
  payload (`{ kallID }` alone, or `{ kallID, subject }`) 500s "Unable to reschedule kool kall"
  instead of a clean 400 — auto-filed by the engine's own pipeline as **#619** [KP-FFF743],
  CRITICAL, now covered by a dedicated regression test instead of only being found by chance.
- **#500** was closed **RESOLVED/FIXED** on 2026-09-22 for fixing a 500 crash on
  `scheduledRepeatKall` — but the underlying capability is still completely broken: every repeat
  interval now answers 400 "Invalid Request" instead (tried with both past and future date ranges,
  ruling out a stale test date), so a repeating call still cannot be created at all. Since this is a
  4xx, the engine's automatic write-flow filing does not pick it up by design — filed explicitly as
  **#622** [KP-1F469E], HIGH, so the regression doesn't hide behind an improved status code.

**Lesson applied**: a ticket's resolution (`FIXED`/`INVALID`) is a claim, not a fact — this bench had
trusted two without a fresh live check and both turned out wrong (one still fully broken, one only
superficially improved). Every "reported fixed" comment elsewhere in the suite should be treated as
provisional until re-verified live, not as a standing fact.

### 10. `kpost/kdiary` — ✅ done (2026-09-24): 10→13/14

**Two stale request payloads fixed, not product bugs**: `saveReport`'s and `editReport`'s bodies were
both inferred (the workbook documents neither) and both wrong. `saveReport` sent `report` for the
text field — live-verified 2026-09-24: the server silently accepts it (200) but the saved row's
`taskReport` column stays null, confirmed against `getTodayReport` immediately after; the real field
is `taskReport`, matching the key every read response already returns it under. `editReport` sent
`eventID` as the target id — the server 400s "Report id is required"; it needs the REPORT's own `id`
(from `saveReport`/`getTodayReport`), not the event's id. Fixed both in `write.api.ts` and in
`feature.spec.ts`'s own hand-built payloads (which had the same two bugs, so the write lifecycle's
report steps were silently no-ops before this).

**Real cross-endpoint chains added**: an event created for today surfaces in both
`getTodaySchedules` and `getEventSelectedDate` (queried for today's date); saving a report for today
is reflected by `getTodayReport` under a real, matching report id.

**1 recorded gap**: `kdiary-get-event-date` — the endpoint definition's own investigation already
found no frontend caller for this route (the app uses `getEvents` + `getEventSelectedDate` instead)
and that it 500s "Value must not be null" for every payload shape tried, curl-verified 2026-09-19.
That stands; the real payload needs confirming with the dev before this can be driven live without
risking a false CRITICAL on a route nobody calls.

### 11. `admin` — ✅ done (2026-09-26): 29→33/38 (87%)

This module (the general Admin/HR-Setup org-build API, distinct from `kpost/admin`'s business-tier
account actions above) has **no FRD** — every finding below came from live behaviour, not a spec.

**A crash bug found and fixed, unrelated to the gap investigation itself**: `admin-workplace-hierarchy`
had never once run to completion in this suite's history. Its call in `feature.spec.ts` used
`allowLiveWrite` (fine for the file's other, `productionSafe` reads) on an endpoint that is
`destructive: false` and NOT `productionSafe` — it needs `allowLiveRead` instead — and sent only
`{ companyId }` despite the endpoint's own definition documenting that a real `parentAttributeId` is
required. Both are fixed; the HR/employee/role-posting sections of the lifecycle test had silently
never executed before this, exactly the same class of bug found earlier this session in Katchup's
`lifecycle.spec.ts`.

**4 of the module's 9 undocumented gaps closed** with real cross-checks, not just "status success":
- `admin-workplace-tier-attribute-by-company` / `admin-hr-tier-attribute-by-company` — each now
  asserts the just-created tier attribute genuinely appears on a fresh company-scoped read.
- `admin-role-posting-by-company` — asserts every returned row genuinely belongs to the caller's
  company (a data-quality invariant, not just "didn't crash").
- `admin-country-address-by-pincode` — a dependency-free reference lookup, moved to a new, ungated
  `reads-workflow.spec.ts` and asserted to resolve a real state/district/area for a known pincode.

**5 remain genuinely blocked**, recorded in a new `needs-id-workflow.spec.ts`:
- `admin-role-posting-suspended-list` — `requestType` enum Unknown/Requires Clarification. Tried live:
  `SUSPEND`, `TERMINATE`, `SUSPEND_TERMINATE`, `ACTIVE`, `INACTIVE`, `ALL`, `Suspended`, `suspended`,
  `SUSPENDED_TERMINATED`, `BOTH`, numeric/boolean/null variants, and alternate field names
  (`status`/`type`/`requestStatus`/`employeeStatus`) — all 400. Even the originally documented
  `"SUSPENDED"` (owner's PDF) is rejected. No frontend source was available to confirm the real value.
- `admin-role-posting-save` / `-update` / `-delete` / `-suspend-terminate` — provision/mutate a real,
  non-reversible external KSMACC account. Meant to run behind a second flag (`ADMIN_ROLE_POSTING_LIVE`)
  on top of `ADMIN_LIFECYCLE`, but **that flag is documented only in a comment — no code anywhere
  reads it**, so this flow has never run even with it set. Wiring it up needs explicit owner
  sign-off first (irreversible external side effect), not done unilaterally.

**A new, still-open Unknown/Requires Clarification finding surfaced by the crash fix**:
`admin-workplace-hierarchy` now reaches the server (previously it never did), but no confirmed
payload returns success — `{ companyId }` alone 400s "parentAttributeId is required"; a REAL
Mongo ObjectId in `parentAttributeId`/`parentVariableId` instead 400s "Request parameter is invalid".
Some value is clearly expected, but neither absence nor a real id satisfies it. Left as a soft,
clearly-commented assertion in `feature.spec.ts` pending the real contract from the dev.

## What this document does NOT yet claim

"API-rich" above means *at least one* business-rule/flow assertion exists — it is a presence check,
not a completeness check. An endpoint counted as API-rich may still be missing individual Phase 2/3/4
scenarios (boundary values, specific negative-input shapes, a particular state transition). Auditing
scenario-level completeness *within* the 156 API-rich endpoints is the next layer of Phase 1 and has
not been done yet — this document only separates "has a business-rule test at all" from "generic-only."

No business rules have been fabricated for any endpoint listed above; where a rule isn't yet known
from code/contract/behavior, it should be recorded `Unknown / Requires Clarification` when Phase 2-4
work reaches that endpoint, per the standing instruction.

## Cleanup note

This audit used throwaway tooling not meant to stay in the repo: `tests/framework/_dump-registry.local.spec.ts`,
`registry-dump.local.json`, `coverage-depth-raw.local.json`, and `coverage-depth3/4/5.local.cjs` in the
repo root. These are removed after this document is written; regenerate them the same way if the
registry changes enough to need a re-audit.
