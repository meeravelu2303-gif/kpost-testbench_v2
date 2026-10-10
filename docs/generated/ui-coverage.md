# UI coverage ledger — every screen, every check

**GENERATED — do not edit.** Written by `tests/framework/ui-coverage.spec.ts`
(`npm run test:framework`). It reconciles the screen registry, the UI check catalogue and the
interaction flows, and fails the build if a screen would route a bug to a non-existent component.

## Screens

Every screen inherits the **full check catalogue** below. Covered: **21** screens (15 personal-session, 1 business-session, 5 public). Sweeps: `screens-batch1..4`, `screens-business`, `screens-public`.

| Screen | Route | Session | Bugzilla component | Key controls checked |
| ------ | ----- | ------- | ------------------ | -------------------: |
| Home | `/home` | personal | Home | 1 |
| Katchup | `/katchup` | personal | Katchup | 2 |
| Kall | `/kall` | personal | Kall | 1 |
| KMail | `/kmail` | personal | KMail | 1 |
| Profile | `/userprofile` | personal | User Profile | 1 |
| Settings | `/settings` | personal | Settings | 1 |
| KDiary | `/kdiary` | personal | KDiary | 1 |
| KCloud | `/kcloud` | personal | KCloud | 1 |
| KBooking | `/kbooking` | personal | KBooking | 1 |
| KNews | `/knews` | personal | KNews | 1 |
| ECommerce | `/e-commerce` | personal | KEcommerce | 1 |
| KDirectory | `/kdirectory` | personal | KDirectory | 1 |
| WriteMail | `/writemail` | personal | WriteMail | 1 |
| KPoster | `/kposter` | personal | General | 1 |
| NotFound | `/this-route-does-not-exist-kpost-bench` | personal | General | 1 |
| UserManagement | `/usermanagement` | business | User Management | 2 |
| Login | `/login` | public | Auth | 2 |
| Signup | `/signup` | public | Auth | 1 |
| ChildSafetyPolicy | `/child-safety-standards-policy` | public | General | 1 |
| KallWindow | `/kall-window` | public | Kall | 1 |
| KPosterPublic | `/kposter` | public | General | 1 |

### Routes that are aliases, not screens

| Route | Resolves to | Note |
| ----- | ----------- | ---- |
| `/` | `/login` | anonymous landing redirects to the login screen |
| `/profile` | `/userprofile` | redirects to the profile screen (verified live 2026-10-10) |

### Public routes that need a real id (kept in their own specs)

| Route | Spec |
| ----- | ---- |
| `/digital-card/:id` | `global-digital-card.spec.ts` |
| `/koolkall/:id` | `global-kool-kall.spec.ts` |
| `/profile-webview/:id` | `profile-webview.spec.ts` |

## UI check catalogue — runs on every screen

**9** checks, the front-end analogue of the API validators:

- `ui.health`
- `ui.performance`
- `ui.layout`
- `ui.accessibility`
- `ui.content`
- `ui.images`
- `ui.security`
- `ui.console`
- `ui.dom`

## Interaction flows (built)

| Flow | Spec | What it drives |
| ---- | ---- | -------------- |
| Navigation | `navigation.spec.ts` | nav-rail icon → route, for every destination |
| Login validation | `login.spec.ts` | empty id / unknown id / valid id advances / wrong password → inline error |
| Login & session (deep) | `login-session.spec.ts` | session guard redirect · Forgot-Password modal (no OTP) · Sign-Up link · logout (gated) |
| Screen shell | `shell.spec.ts` | header + nav rail on every screen |
| Katchup compose | `katchup-compose.spec.ts` | open a chat → open composer → enter Subject (BR-K01) + message; gated send + recall (green) |
| Katchup message actions | `katchup-actions.spec.ts` | sender bell menu → Delete · Edit (Edited marker, BR-K03) · Save · Copy, each self-cleaning (gated) |
| Katchup sub-flow actions | `katchup-actions-more.spec.ts` | bell menu → Note · Reminder · Transfer · Forward · Forward-with-thread · Recall&Repost (entry wired, self-clean, gated) |
| Katchup attach-and-send | `katchup-attach-send-e2e.spec.ts` | compose → attach a real file → upload → send → thread renders the thumbnail (gated, self-clean) |
| Katchup Note sub-flow (completion) | `katchup-note-subflow-e2e.spec.ts` | bell menu Note → composer opens pre-filled with reply context → type a note body → send (gated, self-clean) |
| Katchup Transfer sub-flow (completion) | `katchup-transfer-subflow-e2e.spec.ts` | bell menu Transfer → Katchup recipient picker → select a contact → Done sends (gated, self-clean) |
| Katchup Forward sub-flow (completion) | `katchup-forward-subflow-e2e.spec.ts` | bell menu Forward → recipient picker narrows to one contact → Done → final send button → forward actually sends (gated, self-clean) |
| Katchup secret/confidential message | `katchup-secret-message-e2e.spec.ts` | composer → Secret message → Delete-as-per-Schedule → Done → the confidential message sends (gated, self-clean) |
| Katchup search | `katchup-search.spec.ts` | type in the search box → the conversation list filters to the match (read-only, safe) |
| Katchup two-session | `katchup-two-session.spec.ts` | account 1 sends → account 2 (own context) receives + Reply/Comment/Clarify + read receipt (gated, self-clean) |
| Katchup Copy / Confidential / Bulk | `katchup-copies.spec.ts` | 3-account: visible Copy seen by TO · Confidential Copy hidden from TO (NFR-SEC02) · bulk to many (gated) |
| KMail compose | `kmail-compose.spec.ts` | /writemail form renders (To/Subject/body, green) · compose → send (gated KMAIL_UI_LIFECYCLE) |
| Kall features | `kall-features.spec.ts` | screen + tabs (green) · schedule a Kool Kall via CreateKallModal (gated KALL_UI_LIFECYCLE) |
| Settings sections | `settings-sections.spec.ts` | nav groups + expand General Settings / Profile Creation to their items (read-only, green) |
| Verticals features | `verticals-features.spec.ts` | KNews search · KDirectory · KCloud storage · KDoc/KOS tools · E-Commerce grid render (green) |
| Contacts | `contacts.spec.ts` | contact rail lists + searchable · blocked-contacts screen (read-only) · block→unblock (gated, self-restoring) |
| Group | `group.spec.ts` | create-group modal → Group Name + member → submit → delete (gated, self-cleaning) |
| Profile edit | `profile-edit.spec.ts` | own profile → About section edit pencil → Update → verify → restore (gated, self-restoring) |
| Profile actions | `profile-actions.spec.ts` | three-dot menu (Change Picture/Share/Logout) + About/Experience/Education sections (green) · Experience add (gated) |
| Settings theme | `settings-theme.spec.ts` | Personalize → change KPost layout theme → Apply → verify active → restore original (gated, self-restoring) |

## Deep write flows (planned — gated, need live tuning)

- Katchup group send + per-recipient read receipts (needs 3 QA accounts + recording — confidential-copy and attachments are now built, see Interaction flows above)
- KMail composer: open → recipient/subject → send (gated) → verify in Sent → delete; reply, drafts
- Settings font + notifications: change through the UI → verify applied → restore (theme is built)
- Profile: Edit Profile → change About → Update → verify → restore
- Contacts: search → add → block → unblock → remove (inside the Katchup rail)
- Kall: schedule → verify in log → reschedule (status flips) → delete (direct-call ring stays UI-only)
- KDiary: create event → verify → delete (reached from inside Katchup)

