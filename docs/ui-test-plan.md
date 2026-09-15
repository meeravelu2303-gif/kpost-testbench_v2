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
2. **Check catalogue** — every screen inherits the 4 UI checks automatically (`ui.health`,
   `ui.performance`, `ui.layout`, `ui.accessibility`) — the front-end analogue of the API validators.
   _(read-only, safe)_
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

| #   | Module                 | Screen(s) / route                                                  |  Features |  Est. tests | Status                                    |
| --- | ---------------------- | ------------------------------------------------------------------ | --------: | ----------: | ----------------------------------------- |
| 1   | **Katchup**            | `/katchup`                                                         |        25 |       30–35 | 🟡 5 built (3 green, 2 to tune)           |
| 2   | **Settings**           | `/settings` (24 sections)                                          |        24 |       20–24 | 🟡 1 built (theme), screen done           |
| 3   | **Profile**            | `/userprofile`, `/digital-card`                                    |        11 |       12–14 | 🟡 screen done, writes to build           |
| 4   | **Contacts**           | inside `/katchup`, `/kall`                                         |         7 |        8–10 | 🔴 not started                            |
| 5   | **Group**              | inside `/katchup`                                                  |         8 |        9–10 | 🔴 not started                            |
| 6   | **Kall**               | `/kall`, `/koolkall/:id`                                           |        10 |       10–12 | 🟡 screen done, flows to build            |
| 7   | **KMail**              | `/kmail`, `/writemail`                                             |        15 |       18–20 | 🟡 screen done, flows to build            |
| 8   | **KDiary**             | `/kdiary` (+ inside Katchup)                                       |         6 |         6–8 | 🔴 not started                            |
| 9   | **Home / Dashboard**   | `/home`                                                            |         5 |         5–6 | 🟡 screen done, flows to build            |
| 10  | **Login & session**    | `/login`, header logout                                            |         8 |         6–8 | 🟢 mostly done (4 states)                 |
|     | **In-scope total**     |                                                                    |   **119** | **124–147** |                                           |
| —   | Admin / UserManagement | `/usermanagement`                                                  |        10 |       10–12 | ⏸ needs a business company (3 members)    |
| —   | Verticals              | `/kcloud` `/kbooking` `/knews` `/e-commerce` `/kdirectory` `/kdoc` | 6 screens |        6–12 | ⏸ owner scope call (screen-smoke vs deep) |

Legend: 🟢 done · 🟡 partially built · 🔴 not started · ⏸ blocked/deferred.

---

## Per-module feature breakdown (the checklists we build against)

### 1. Katchup — `/katchup` (flagship: the product's reason to exist)

The differentiators live here (subject on every message, rich post-send control, read receipts).
**Sender bell menu** and **recipient reply menu** are the two action sets (BR-K02).

- [ ] Compose: Subject (BR-K01) + body — _(green)_
- [ ] Send 1:1 → verify appears — _(green)_
- [ ] Recall (unsend, FR-K10/BR-K03) — _(green)_
- [ ] Delete (sender-side) — _(built, tune)_
- [ ] Edit + `Edited` marker (BR-K03) — _(built, tune)_
- [ ] Recall & Repost · Note · Reminder · Transfer
- [ ] Forward · Forward-with-thread
- [ ] Copy · Save · mark-important · Text-to-Speech
- [ ] Recipient actions: Reply · Comment · Clarify · Report · More
- [ ] Confidential Copy hidden from other recipients (NFR-SEC02, needs 3 QA accts)
- [ ] Group send + per-recipient read receipts (FR-K06/K07)
- [ ] Attachments: attach → send → thumbnail → delete
- [ ] Search message / search subject; conversation open + switch; contact rail

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

### 3. Profile — `/userprofile`

- [ ] Edit About → Update → verify → restore
- [ ] Designation · Basic info · Contact info · Privacy → save → restore
- [ ] Education / Experience: add → verify → delete
- [ ] Profile image · Cover image · Signature upload
- [ ] Digital card view (`/digital-card/:id`)

### 4. Contacts — inside `/katchup`, `/kall`

- [ ] Search a QA account → add → verify in list → remove
- [ ] Block → verify → Unblock
- [ ] Unknown Katchup contacts list · My groups list · imported phone contacts (read-only)

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

### 10. Login & session — `/login` (mostly done)

- [x] Empty id / unknown id / valid id advances / wrong password → inline error
- [x] Successful login → `/home`; header logout → `/login`
- [ ] Forgot-password flow (screen only; OTP-gated) · access code screen

---

## Execution order (recommended)

**Katchup first** — it is the flagship (the differentiators), we already have momentum and validated
selectors, and finishing it proves the full per-module loop end-to-end (build → tune → file valid
bugs). Then, in value order: **Settings → Profile → Contacts → Group → Kall → KMail → KDiary → Home**,
and **Login** just needs its two remaining screens. **Admin** and the **verticals** are deferred
(business accounts / owner scope call).

Each module is finished — all five layers, valid bugs filed — before the next begins.

---

## What blocks nothing vs what needs you

- **Needs nothing** — Katchup (core), Settings, Profile, Kall, KMail, KDiary, Home, Login: the 6 QA
  accounts are enough. I build + you run one tuning pass per module.
- **Needs the tuning pass** — every write flow needs one live headed run to confirm selectors (a
  2-minute `codegen` fixes any that are off). This is the only thing I cannot do alone.
- **Deferred** — Admin (a business company with 3 members, one expendable); the verticals
  (KDoc/KCloud/KBooking/KNews/E-Commerce/Kdirectory — you decide screen-smoke vs deep coverage).
