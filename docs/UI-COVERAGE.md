# UI coverage ledger — every screen, every check

**GENERATED — do not edit.** Written by `tests/framework/ui-coverage.spec.ts`
(`npm run test:framework`). It reconciles the screen registry, the UI check catalogue and the
interaction flows, and fails the build if a screen would route a bug to a non-existent component.

## Screens

Every screen inherits the **full check catalogue** below. Covered: **13** screens.

| Screen | Route | Bugzilla component | Key controls checked |
| ------ | ----- | ------------------ | -------------------: |
| Home | `/home` | Home | 1 |
| Katchup | `/katchup` | Katchup | 2 |
| Kall | `/kall` | Kall | 1 |
| KMail | `/kmail` | KMail | 1 |
| Profile | `/userprofile` | User Profile | 1 |
| Settings | `/settings` | Settings | 1 |
| KDiary | `/kdiary` | KDiary | 1 |
| KDoc | `/kdoc` | KDoc | 1 |
| KCloud | `/kcloud` | KCloud | 1 |
| KBooking | `/kbooking` | KBooking | 1 |
| KNews | `/knews` | KNews | 1 |
| ECommerce | `/e-commerce` | KEcommerce | 1 |
| KDirectory | `/kdirectory` | KDirectory | 1 |

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

- Katchup group / confidential-copy / attachments (needs 3 QA accounts + recording)
- KMail composer: open → recipient/subject → send (gated) → verify in Sent → delete; reply, drafts
- Settings font + notifications: change through the UI → verify applied → restore (theme is built)
- Profile: Edit Profile → change About → Update → verify → restore
- Contacts: search → add → block → unblock → remove (inside the Katchup rail)
- Kall: schedule → verify in log → reschedule (status flips) → delete (direct-call ring stays UI-only)
- KDiary: create event → verify → delete (reached from inside Katchup)

