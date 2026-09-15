# UI test plan — module by module, to completion (the master tracker)

This is the UI equivalent of how the API side was built: **take one module, complete the whole thing
— every screen, every feature, valid bugs filed to KPost UI — then move to the next.** This file is
the living tracker; update the Status column as each module is finished.

Goal (owner): **production full-coverage test bench with valid bugs for UI and API both.** API side is
built (11 modules, ~337 endpoints, live + gated write lifecycles). This plan finishes the UI side to
the same bar.

---

## What "a UI module is complete" means (the definition of done)

Same rigor as an API module. A UI module is done when all five layers pass:

1. **Screen render** — the route loads authenticated, and **every key control is present** (not an
   empty shell). Cross-browser (Chromium/Firefox/WebKit). _(read-only, safe)_
2. **Check catalogue** — every screen inherits **9 bug-finding checks** automatically, the front-end
   analogue of the API validators, so the deep sweep catches every class of UI bug on the live app:
   `ui.health` (JS crash / broken asset), `ui.performance`, `ui.layout`, `ui.accessibility`,
   **`ui.content`** (a value rendered as literal `undefined` / `NaN` / `[object Object]` — the
   highest-signal UI bug), **`ui.images`** (broken images), **`ui.security`** (mixed http content on
   an https page), **`ui.console`** (app console errors), **`ui.dom`** (duplicate ids). _(read-only,
   safe)_
3. **Feature flows** — every real interaction the module offers is driven like a user: the happy path
   **and** its variations. Writes are **gated** (`*_UI_LIFECYCLE`) and **self-cleaning** (the account
   ends as it started), targeting only the 6 QA accounts. This is the bulk of the work.
4. **Validation / negative UI** — empty inputs, invalid inputs, error toasts, disabled states — the
   client-side rules a user hits.
5. **Valid bugs filed** — MEDIUM+ findings file to **KPost UI → Ayyappan Ashok** on the screen's
   component, deduped by the `[KP-…]` tag, no false positives (tuned first with `BUGZILLA_DRY_RUN`).

**The per-module loop** (never skip a step):

```
build the specs from the frontend (mined selectors)  →  npm run check clean
→ tune live headed (setup → codegen where a selector is off → green)
→ dry-run filing (BUGZILLA_DRY_RUN=true) → confirm 0 false positives
→ arm filing → valid bugs land on KPost UI
→ mark the module DONE here → next module
```

---

## The modules, features, and test counts

Counts are grounded in the frontend routes (`MenuRoutes.js`) and components
(`D:\KPOST_PROJECTS\KPOST_REACTJS_2023_V1`). "Tests" ≈ Playwright test cases (a flow + its variations);
the 4 checks per screen are additional and automatic. Estimates, refined as each module is built.

**Order = the API build order** (owner's call). **Every module gets DEEP coverage** — including the
verticals (owner's call), not screen-smoke.

| #   | Module                   | Screen(s) / route                  | Features |   Est. tests | Status                                           |
| --- | ------------------------ | ---------------------------------- | -------: | -----------: | ------------------------------------------------ |
| 1   | **Login & session**      | `/login`, `/signup`, header logout |       10 |         8–10 | 🟢 deep-complete (logout to tune)                |
| 2   | **Profile**              | `/userprofile`, `/digital-card`    |       11 |        12–14 | 🟡 screen deep + About-edit built                |
| 3   | **Katchup**              | `/katchup`                         |       35 |        30–35 | 🟢 measured: 20 built / 15 blocked-w-reason      |
| 4   | **Contacts**             | inside `/katchup`, `/kall`         |        7 |         8–10 | 🟡 read-only + block/unblock built (add to tune) |
| 5   | **Group**                | inside `/katchup`                  |        8 |         9–10 | 🟡 create/rename/delete built (send to tune)     |
| 6   | **Kall**                 | `/kall`, `/koolkall/:id`           |       10 |        10–12 | 🟡 screen done, flows to build                   |
| 7   | **KMail**                | `/kmail`, `/writemail`             |       15 |        18–20 | 🟡 screen done, flows to build                   |
| 8   | **KDiary**               | `/kdiary` (+ inside Katchup)       |        6 |          6–8 | 🔴 not started                                   |
| 9   | **Settings**             | `/settings` (24 sections)          |       24 |        20–24 | 🟡 1 built (theme), screen done                  |
| 10  | **Home / Dashboard**     | `/home`                            |        5 |          5–6 | 🟡 screen done, flows to build                   |
| 11  | **Admin / UserMgmt**     | `/usermanagement`                  |       10 |        10–12 | ⏸ needs a business company (3 members)           |
| 12  | **KDoc / KPresentation** | `/kdoc`                            |        8 |         8–10 | 🟡 deep check-sweep; flows need APIs             |
| 13  | **KCloud**               | `/kcloud`                          |        6 |          6–8 | 🟡 deep check-sweep on the screen                |
| 14  | **K-Booking**            | `/kbooking`                        |        6 |          6–8 | 🟡 deep check-sweep on the screen                |
| 15  | **KNews**                | `/knews`                           |        5 |          5–6 | 🟡 deep check-sweep on the screen                |
| 16  | **K-ECommerce**          | `/e-commerce`                      |        6 |          6–8 | 🟡 deep check-sweep on the screen                |
| 17  | **Kdirectory**           | `/kdirectory`                      |        5 |          5–6 | 🟡 deep check-sweep on the screen                |
|     | **Total**                |                                    | **~167** | **~150–190** |                                                  |

Legend: 🟢 done · 🟡 partially built · 🔴 not started · ⏸ blocked/deferred.

**All 13 authenticated screens are now in the deep check sweep** (`src/ui/screens.ts` →
`screens.spec.ts`): every screen — core and vertical — is navigated and run through the full check
catalogue (health / performance / layout / a11y), filing MEDIUM+ findings. The verticals use the
authenticated **shell** as the mount anchor (they ship generic bootstrap layouts); their feature
_flows_ still need building (KDoc waits on the owner's KPresentation/KDoc APIs).

**✅ Bugzilla components — created and wired (2026-09-15).** The KPost UI product now has **21
components** (was 12). Nine were created so every screen/module routes to its own component (parity
with the API product's 27): **Kall, User Profile, KDiary, KDoc, KCloud, KBooking, User Management,
Contacts, Groups** (ids 75–83, default assignee Ayyappan). `UI_COMPONENT_BY_SCREEN` and
`KNOWN_COMPONENTS['kpost-ui']` map every screen to its dedicated component — **no `General`
catch-all for any real screen**. The `component-routing`, `ownership` and `ui-coverage` framework
tests (which reconcile config against the live Bugzilla) all pass.

Full KPost UI component set: Accessibility · Auth · Contacts · General · Groups · Home · Kall ·
Katchup · KBooking · KCloud · KDiary · KDirectory · KDoc · KEcommerce · KMail · KNews · KPay ·
Settings · User Management · User Profile · WriteMail.

---

## Per-module feature breakdown (the checklists we build against)

### 1. Katchup — `/katchup` (flagship: the product's reason to exist)

The differentiators live here (subject on every message, rich post-send control, read receipts).
**Sender bell menu** and **recipient reply menu** are the two action sets (BR-K02).

**Katchup coverage is now measured, not hand-listed** — the authoritative per-feature status lives in
**`docs/KATCHUP-UI-COVERAGE.md`** (generated from `src/ui/katchup-features.ts`, reconciled by
`tests/framework/katchup-ui-coverage.spec.ts`, which fails the build if a feature is unclassified or an
FR-K id is unrepresented). Snapshot: **35 features · 20 built · 15 blocked-with-reason.**

- **Built (20):** compose (subject/body/send), sender bell actions (Delete · Edit · Save · Copy · Note ·
  Reminder · Transfer · Forward · Forward-with-thread · Recall&Repost), recipient actions
  (Reply · Comment · Clarify), read receipts + threads (two-session), search. Specs:
  `katchup-compose` · `katchup-actions` · `katchup-actions-more` · `katchup-search` ·
  `katchup-two-session`.
- **Blocked-with-reason (15):** 6 `needs-received` (secret · share-card · share-location · Report ·
  More · unread-badge — harness exists, sub-flows need recording), 4 `needs-accounts` (Cc ·
  confidential-copy · group · bulk — need ≥3 QA accounts), 1 `needs-upload` (attachments), 2 `api-only`
  (schedule-call · mark-important), 2 `ui-only` (Text-to-Speech · Print).

### 2. Settings — `/settings` (24 sections; safest writes, self-restoring)

Sections: Personalize(theme/font), Notification, About, BasicInformation, ContactInformation,
SecurityPrivacy, ChangePassword, ChangeMobNumber, BlockedContact, InstantReply, VacationResponse,
MailSignature, LetterHead, DigitalCardSettings, DataStorage, Education, Experience, AccountRecovery,
DeleteAccount, OtherMail, OtherActivities, KnewsSettings, BusinessSettings, SettingProfile.

- [ ] Personalize → layout theme change → restore — _(built, tune)_
- [ ] Personalize → font change → restore
- [ ] Notification toggles (3) → restore
- [ ] InstantReply / VacationResponse / MailSignature → set → verify → clear
- [ ] Each remaining section: renders + its safe write where one exists (read-only for
      ChangePassword/ChangeMobNumber/DeleteAccount — assert the form, never submit)

### 2. Profile — `/userprofile`

- [x] Screen: name, photo, About, self-actions (Edit Profile / Share / Change-photo) _(`profile.spec.ts`)_
- [x] Edit About → Update → verify → restore _(built, gated `PROFILE_UI_LIFECYCLE`, tune)_
- [ ] Designation · Basic info · Contact info · Privacy → save → restore (same `#section` pencil pattern)
- [ ] Education / Experience: add (`.icon-KP_45-Add`) → verify → delete
- [ ] Profile image · Cover image · Signature upload (`.pChangePic_btn`)
- [ ] Digital card view (`/digital-card/:id`)

### 4. Contacts — inside `/katchup`, `/kall`

- [x] Contact rail lists contacts + searchable (read-only) — `contacts.spec.ts`
- [x] Blocked-Contacts screen renders (read-only) — `contacts.spec.ts`
- [x] Block → verify → Unblock (gated `CONTACTS_UI_LIFECYCLE`, self-restoring, tune) — `contacts.spec.ts`
- [ ] Add contact (the `AddContact.js` rail flow) — needs one recording pass (deeply nested trigger)
- [—] Unknown contacts / groups / imported phone contacts — read-only lists, covered by the rail render

### 5. Group — inside `/katchup`

- [ ] Create group → verify
- [ ] Add member · make admin · rename · set image
- [ ] Leave · remove member · delete (remove all members first)

### 6. Kall — `/kall`

- [ ] Schedule a call → verify in log → reschedule (status flips, BR-C01) → delete
- [ ] Direct-call UI: open dialer, assert controls — **do not place** (rings a real device)
- [ ] Call log / history render · frequent contacts · today's kool-kall · modify members · clear history

### 7. KMail — `/kmail`, `/writemail`

- [ ] Compose New → recipient (QA mailbox) + subject + body → send → verify in Sent → delete
- [ ] Reply · Forward
- [ ] Draft: save → verify → delete
- [ ] Confidential (bcc) hidden from TO/CC (NFR-SEC02)
- [ ] Bulk mail · mail status / read receipts (BR-M01) · folders · signature · KMail contacts

### 8. KDiary — `/kdiary` (also reached inside Katchup)

- [ ] Create event → verify → delete
- [ ] Today's schedule · events list · reports (read-only) · edit event

### 9. Home / Dashboard — `/home`

- [ ] Recent-messages panel renders + opens a conversation
- [ ] Quick compose entry · notifications · nav rail (shell)

### 1. Login & session — `/login` (DEEP-COMPLETE bar the logout tuning pass)

- [x] Empty id / unknown id / valid id advances / wrong password → inline error _(green)_
- [x] Successful login → `/home` _(proven by `setup`)_
- [x] Session guard: an unauthenticated user on an authenticated route → `/login` _(`login-session.spec.ts`)_
- [x] Forgot-Password link opens the reset modal _(safe — no OTP requested, `login-session.spec.ts`)_
- [x] Sign-Up link leaves `/login` for registration _(`login-session.spec.ts`)_
- [ ] Header logout → `/login` _(built, gated `LOGIN_UI_LIFECYCLE`, needs one tuning pass — native confirm)_
- [—] Forgot-Password completion / access code — **OTP-gated on live, screen-only by design**

---

## Execution order (owner's call — the API build order, every module deep)

**Login → Profile → Katchup → Contacts → Group → Kall → KMail → KDiary → Settings → Home → Admin →
KDoc → KCloud → K-Booking → KNews → K-ECommerce → Kdirectory.** Each module is finished — all five
layers, valid bugs filed — before the next begins. **Currently on Module 1 (Login).**

---

## What blocks nothing vs what needs you

- **Needs nothing** — Login, Profile, Katchup (core), Contacts, Group, Kall, KMail, KDiary, Settings,
  Home, and the verticals: the 6 QA accounts are enough. I build + you run one tuning pass per module.
- **Needs the tuning pass** — every write flow needs one live headed run to confirm selectors (a
  2-minute `codegen` fixes any that are off). This is the only thing I cannot do alone.
- **Deferred** — Admin (needs a business company with 3 members, one expendable). KDoc goes deep once
  the owner shares the KPresentation/KDoc APIs; its screen coverage starts now regardless.
