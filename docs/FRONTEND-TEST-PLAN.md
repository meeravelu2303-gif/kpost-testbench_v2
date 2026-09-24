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

- [ ] Confirm with the product owner whether `/kdiary`'s missing route is a defect (file it) or
      intentional (note it and move on) — do **not** guess.
      Verify: is `WriteMail.js` truly dead code, or reachable some other way (deep link, feature flag)?
- [ ] Verify the `interceptFetch.js` host allowlist against the actual **test-build** environment
      config, to confirm the bench's target hosts are genuinely what the deployed test UI calls.
- [ ] Confirm whether K-Booking / KNews / KCloud / K-ECommerce have a real backend at all (they don't
      appear in `docs/COVERAGE.md`) — if there's no API, UI tests for them are read-only/UI-state-only
      by necessity, and that's a finding to state up front, not discover mid-phase.

## Phase 1 — close the Settings gap (highest ROI: mostly-tested APIs, thin UI layer)

21 of 25 real Settings panels have no UI test today, and most already have a tested backing API
(`profile`, `generalsetting`, `kmail`'s `kmailSetting`, `contacts`) — this is the fastest path to real
coverage because the hard API-layer work is largely done.

- [ ] Per untested panel (AccountRecovery, BusinessSettings, ChangeMobNumber\*, ChangePassword\*,
      DataStorage, DeleteAccount\*, DigitalCardSettings, KnewsSettings, LetterHead, OtherMail,
      SecurityPrivacy, Settingdetails, SettingProfile, VacationResponse): 1. Codegen the panel open + its one or two real actions. 2. Identify its backing endpoint(s) from `Services/*.js`. 3. Write functional (does the action reach the API/DB) + validation (bad input rejected) + a breakage-sweep entry.
      (\* ChangePassword/ChangeMobNumber/DeleteAccount are destructive — gate behind their own lifecycle
      flag and a dedicated safety design, same rigor as the account-mutation work already done.)
- [ ] Extend `accessibility-axe.spec.ts`'s `AUTHENTICATED_SCREENS` list if Settings sub-panels aren't
      already walked individually (currently it walks top-level routes; deep panels may need their
      own entries, mirroring the Profile/Settings breakage-sweep's sub-section walk).

## Phase 2 — zero-coverage modules (Katchup-adjacent effort scale: small; start here for breadth fast)

Ordered by likely user impact, cheapest first:

- [ ] **KNews** (3 files) — read-only content feed; likely just a breakage-sweep + a "does it load
      real content, not an empty/error state" functional check.
- [ ] **K-Booking** (3 files) — has a `TicketTemplate.js` and `BusLoader.js`, suggesting a real
      booking/ticket flow with forms — needs its own functional + validation pass once the backend is
      confirmed (Phase 0).
- [ ] **KCloud** (2 files) — file storage; likely upload/list/delete functional flow.
- [ ] **K-ECommerce** (2 files) — likely product listing + checkout-adjacent flow; scope after
      confirming what state it's actually in (2 files is thin for a commerce flow — may be an iframe
      or external embed, which changes the whole test approach).
- [ ] **UserManagement** (1 file, but likely admin-role-gated) — cross-reference against the existing
      Admin API suite (`admin` 51/125 tested) before assuming this is new backend surface; this may
      largely be **that** API already covered from a different UI entry point.
- [ ] **ChildSafetyPolicy** — static compliance page; a single breakage + accessibility check is
      probably sufficient scope, not a large investment.

## Phase 3 — deepen the "API only" modules with real UI coverage

Kmail, Kall, KOS all have thorough API coverage but no UI functional layer yet.

- [ ] **Kmail UI** (25 files) — compose/send, reply/forward, draft, folders, priority/bcc — mirror the
      already-built `katchup-functional.spec.ts` pattern (client-side validation, state-after-action).
- [ ] **Kall UI** (21 files) — call initiation, scheduled/repeat call UI (note: backend bugs already
      found here — #500/#501 — verify fixed before/while building UI coverage so it isn't blocked by
      known server defects).
- [ ] **KOS UI** (8 files) — document create/edit/share screens, once `/kword/create`'s backend defect
      (#499, reported fixed — reverify) is confirmed actually fixed.

## Phase 4 — Katchup and Kmail deep-dive (the two largest, most complex modules)

- [ ] Katchup (120 files) already has the deepest coverage of any module — this phase is about
      **closing remaining gaps** found by re-reading its subfolders (`bubble/`, `classic/`,
      `components/`) against what's actually tested, not starting from zero.
- [ ] Kmail equivalent pass once Phase 3's baseline UI layer exists.

## Reporting cadence

After each phase: update `docs/COVERAGE.md`-style numbers for the UI side (currently that ledger is
API-only), and a short note in this file marking phases done/in-progress — so this plan stays a
living document, not a one-time snapshot.
