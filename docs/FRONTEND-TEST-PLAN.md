# KPost frontend — phased test implementation plan

Companion to `FRONTEND-MODULE-MAP.md`. Built from that structural analysis; each phase's "analyze"
step happens just before that phase's "implement" step (see that doc's closing note on why).

## Standing conventions (apply to every phase — already proven this session)

- **Cross-layer, not single-layer**: functional UI checks assert on the API/DB outcome, not just "the
  screen didn't crash" (e.g. a toggle's real proof is the DB row changing, not the switch animating).
- **One root cause = one ticket**: reuse `systemicFingerprint` / the accessibility-rule-collapse
  pattern whenever one defect could surface on many screens — never file per-screen duplicates.
- **Valid-only filing**: every candidate passes the gatekeeper (evidence → validity → 3-pass
  reproduction) before Bugzilla; lenient-accepted 2xx on negative input is not a bug (see #534).
- **Real, readable proof**: a static defect (WCAG, a resting form) gets an on-screen overlay painted
  before the screenshot/video, exactly like the crash-sweep and accessibility work — never a blank
  screenshot or a wasted long recording.
- **Test types per module, not just "does it load"**: functional, negative/boundary, validation,
  cross-layer integration (UI→API→DB), security (auth/IDOR where applicable), and a breakage/crash
  sweep. Concurrency and destructive write-fuzzing stay opt-in (`kpost:deep`) per module's own
  endpoints, not added to UI specs.
- **Safety**: write/destructive UI flows stay behind their own `*_UI_LIFECYCLE` flag, self-clean, and
  never touch another user's data without an explicit second-account safety design (see the IDOR
  work on Katchup/Group/KWord this session).

## Phase 0 — before writing any new test (do once)

- [x] **`/kdiary`'s route status has CHANGED since this doc was written** (2026-09-30, re-read
      `MenuRoutes.js` directly): the route is **NOW LIVE** — `<Route path="/kdiary" element={<KDiary />} />`
      is present and NOT commented out (only `/writemail`'s dead alternate — see below — is commented).
      This contradicts `kdiary.spec.ts`'s own note and bug #812 (filed 2026-09-29, "no route/rail entry
      point"), both dated BEFORE this observation. The frontend was very likely redeployed with the
      route re-enabled since #812 was filed. **Action needed**: re-verify live (once a UI run is safe —
      not while `kpost:full:file` is active) whether `/kdiary` is now directly reachable and whether
      `kdiary.spec.ts`'s permanent `test.skip(true, ...)` gates should be lifted; if confirmed working,
      re-open/update #812 rather than leaving it recorded as still-broken.
- [x] `WriteMail.js` confirmed genuinely dead code: `MenuRoutes.js` line 423 routes `/writemail` to
      `Kmail`, and the only reference to rendering the actual `WriteMail` component is a commented-out
      line directly below it (424). No other route or deep link reaches it. Not worth testing.
- [x] `interceptFetch.js`'s hardcoded host allowlist (`devapi2.kpostindia.com`, `kmail5.…`, `kmail.…`,
      `kpostapis.…`) does NOT literally list `testingapi.kpostindia.com`/`testkmail.kpostindia.com`, but
      `Services/ServiceURL.js`'s `config` object in THIS checkout resolves `EndPoint`/`KmailEndPointURL`
      to exactly those test hosts — matching the bench's own `.env` (`KPOST_API_BASE_URL`,
      `KMAIL_API_BASE_URL`) exactly. Combined with the empirical fact that every authenticated UI test
      this session has successfully reached real, live, token-gated data on `test.kpostindia.com`, this
      confirms auth injection genuinely works end-to-end in this environment — `interceptFetch.js`'s own
      literal array is just stale relative to `ServiceURL.js`, not a real blocker. No further action.
- [x] K-Booking / KNews / KCloud / K-ECommerce backend reality, confirmed from source (2026-09-30):
  - **K-Booking**: real backend (`Services/KBooking.js`, redbus.in integration) — see the hard payment
    safety boundary already documented below.
  - **KNews**: NO KPost backend at all — `NewsList.js` fetches EXTERNAL RSS feeds directly
    (`COUNTRY_FEEDS_URL`/`ISO_CODES_URL`/per-country RSS `fetch()` calls, no `Services/*` import for
    content) and cross-calls Katchup's own `SendMessage` to share an article. UI tests here are
    inherently at the mercy of live third-party feed availability — scope as "does the screen render
    SOMETHING and handle a feed failure gracefully," not "does article X appear," and do not assert on
    specific external content.
  - **KCloud**: confirmed NO backend at all for `KCloudStorage.js` (zero `Service`/`fetch`/`axios`
    imports, pure local `useState`) — its `buydata`/`buyyearlyone..three`/`paymentone..three` state
    strongly suggests a "buy more storage" UI, but with no live payment wiring found, unlike K-Booking's
    genuine Razorpay/PayU-style flow. Safe to test as pure UI-state (tabs, modal opens/closes) with no
    payment-safety concern — the left rail (Recent/Contact tabs) reuses Katchup's own shared components
    (same pattern as Home/Dashboard), so only `KCloudStorage` itself is this module's unique surface.
  - **K-ECommerce**: HAS a real, correctly-wired backend — `Fetch_ECommerceDetails()` in
    `Services/ECommerce.js` calls the genuine `/v2/ecommerce/getEcommerceDetails/` endpoint (the
    module-map's caution about that file being "KDiary leftover" applies to its OTHER exports, not this
    one). `docs/COVERAGE.md` marks the whole `ecommerce` API (2 endpoints) **out-of-scope — third-party
    commerce; confirm scope with owner** — UI testing should match that same caution: a read-only render
    check is fine, no assumption that write/purchase actions are safe to drive.

## Phase 1 — close the Settings gap (highest ROI: mostly-tested APIs, thin UI layer) — ✅ DONE 2026-09-30

All 14 previously-untested panels now have a spec file (AccountRecovery, SecurityPrivacy,
ChangeMobNumber, ChangePassword, DeleteAccount, DataStorage, DigitalCardSettings, KnewsSettings,
LetterHead, OtherMail, VacationResponse, SettingProfile, BusinessSettings' BankDetails+CompanyDetails).
None run live yet. Real findings surfaced straight from source, several strong enough to be bug
candidates once live-verified:

- **ChangePassword**: `changePasswordApi`'s request body sends only `{oldPassword, confirmPassword}` —
  the validated `newPassword` value is never included in the payload. Flagged, not filed (no safe way
  to drive step 2 without a dedicated spare account — see `settings-change-password.spec.ts`).
- **ChangeMobNumber** and **SecurityPrivacy**: both are ENTIRELY client-side theater — zero
  `Services/*` calls anywhere, despite ChangeMobNumber's multi-step OTP flow and explicit data-loss
  warning text, and SecurityPrivacy's fully-wired 5-dropdown chain ending in a Submit with no
  `onClick` at all. Both fully exercised and confirmed via `page.on('request')` never firing.
- **VacationResponse**: three separate bugs, each directly exercised (not just read from source): the
  on/off toggle disables a wrapping `<div>` (no effect on the real inputs), both message `<textarea>`s
  have a JSX typo (`v alue=` instead of `value=`) breaking React's controlled-value binding, and "Save"
  replaces the whole state OBJECT with a bare STRING (`setValue("")`) — a live-crash candidate the test
  watches for via `watchUiHealth` rather than assuming.
- **DataStorage**: top-level "Buy" and every plan's "Buy Monthly" are dead buttons (no `onClick`);
  only "Buy Yearly" → modal → Cancel exists — no real purchase path to protect at all.
- **OtherMail**: its provider dropdown is labelled "Vacation Response" with placeholder "Enter the
  Vacation Reason" — confirmed copy-paste leftover from the unrelated VacationResponse panel.
- **DeleteAccount** / **BankDetails**: both have real, destructive/irreversible backend calls
  (`deactivateAccount`, `sendAccountDeactivationOtp`, `updateBankAccountDetails`) with NO safe way to
  clean up afterward (Bank's own "Delete" is confirmed client-side-only, no real delete endpoint) — both
  scoped conservatively to validation/reachability only, never completing the real destructive action.
- Settings' nav accordion (`Settingdetails.js`) closes every sibling group when one opens — a new
  `SettingsPage.ts` page object + `settingsPage` fixture (mirroring `homePage`) now owns that
  navigation centrally for all current and future Settings specs.

## Phase 2 — zero-coverage modules — ✅ DONE 2026-09-30 (ChildSafetyPolicy separately, see below)

- [x] **KNews** — no KPost backend for content (external RSS `fetch()` calls only); scoped to "reaches
      one of its 3 documented real states (articles/empty/error)," search-box filter, World country
      selector, and the Share-to-Katchup Forward modal opening (never completes a real send).
- [x] **K-Booking** — confirmed a REAL redbus.in payment integration; scoped strictly to the safe
      surface (city search validation, trip listing, read-only "My Trips") per the hard safety boundary
      already documented in `FRONTEND-MODULE-MAP.md` — the "Show seats" link is the boundary, never
      clicked.
- [x] **KCloud** — confirmed NO backend at all; fully driven (buy-flow dead buttons, the local-only
      "Payment SuccessFul" round trip, Documents/Clear-buttons dead-button confirmation).
- [x] **K-ECommerce** — confirmed a REAL backend (`getEcommerceDetails`) marked out-of-scope for API
      testing (third-party commerce); scoped to read-only render + a new-tab click-through intercept,
      matching that same caution. Confirmed gap worth flagging: no loading/error state exists in
      `ECommerceList.js` — an empty grid is visually indistinguishable from a failed fetch.
- [x] **UserManagement** — already built earlier this session (`usermanagement*.spec.ts`).
- [x] **ChildSafetyPolicy** — **CRITICAL FINDING**: the entire source file is commented out, including
      its own `export default` — the component has no live export at all. `MenuRoutes.js` imports it as
      `undefined` and renders `<ChildSafetyPolicy />`, which React cannot mount. This is a public route
      (no auth needed) predicted to crash on load. `child-safety-policy.spec.ts` asserts the CORRECT
      behavior (heading renders, no uncaught error) so a live run's failure is the verification evidence
      needed before filing — about as high-confidence a source-level finding as exists.

## Phase 3 — deepen the "API only" modules with real UI coverage

- [x] **Kmail UI** — compose/send built (`kmail.spec.ts`, `kmail-compose.spec.ts`), plus security +
      accessibility + dynamic-state health/perf/layout coverage (2026-09-30 pass, see
      [[project-kpost-ui-100-percent-effort]] in the QA agent's memory). Reply/forward/draft/folders
      not yet built — KMail's UI doesn't appear to expose those beyond compose today; reverify against
      source if the product actually has them before assuming this is a real gap.
- [x] **Kall UI** — screen + Kool Kall schedule-form built (`kall.spec.ts`, `kall-features.spec.ts`),
      plus security/accessibility/dynamic-state coverage. Full schedule Submit remains blocked on a
      codegen-pending participant-picker step (documented in `kall-features.spec.ts`), not backend
      defects — #500/#501 status not reverified this pass.
- [x] **KOS UI** — built 2026-09-30: `kos.spec.ts` (tool picker, 4 "Coming Soon" placeholders
      confirmed legitimate/unbuilt not buggy, KPresenter's external-redirect behavior), `kword.spec.ts`
      (empty-title validation + a full gated create→save→delete lifecycle against the real
      `/kword/create`/`/saveContent`/`/delete` endpoints), `kai.spec.ts` (real AI backend, prompt
      render + empty-prompt guard), `kad-document.spec.ts` (read-only listing/search; the real
      `ShareKADDocument` write is NOT driven to completion — no simple self-clean available yet).
      No `#499` defect-number comment was found anywhere in KOS source — the test plan's memory of a
      "reported fixed" backend defect could not be corroborated from the frontend; treat `/kword/create`
      as needing a fresh live check, not a known-fixed item.

## Phase 4 — Katchup and Kmail deep-dive (the two largest, most complex modules)

- [ ] Katchup (120 files) already has the deepest coverage of any module — this phase is about
      **closing remaining gaps** found by re-reading its subfolders (`bubble/`, `classic/`,
      `components/`) against what's actually tested, not starting from zero.
- [ ] Kmail equivalent pass once Phase 3's baseline UI layer exists.

## Reporting cadence

After each phase: update `docs/COVERAGE.md`-style numbers for the UI side (currently that ledger is
API-only), and a short note in this file marking phases done/in-progress — so this plan stays a
living document, not a one-time snapshot.
