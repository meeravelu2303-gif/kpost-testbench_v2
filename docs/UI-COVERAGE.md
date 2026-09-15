# UI coverage ledger — every screen, every check

**GENERATED — do not edit.** Written by `tests/framework/ui-coverage.spec.ts`
(`npm run test:framework`). It reconciles the screen registry, the UI check catalogue and the
interaction flows, and fails the build if a screen would route a bug to a non-existent component.

## Screens

Every screen inherits the **full check catalogue** below. Covered: **6** screens.

| Screen | Route | Bugzilla component | Key controls checked |
| ------ | ----- | ------------------ | -------------------: |
| Home | `/home` | Home | 1 |
| Katchup | `/katchup` | Katchup | 2 |
| Kall | `/kall` | General | 1 |
| KMail | `/kmail` | KMail | 1 |
| Profile | `/userprofile` | Settings | 1 |
| Settings | `/settings` | Settings | 1 |

## UI check catalogue — runs on every screen

**4** checks, the front-end analogue of the API validators:

- `ui.health`
- `ui.performance`
- `ui.layout`
- `ui.accessibility`

## Interaction flows (built)

| Flow | Spec | What it drives |
| ---- | ---- | -------------- |
| Navigation | `navigation.spec.ts` | nav-rail icon → route, for every destination |
| Login validation | `login.spec.ts` | empty id / unknown id / valid id advances / wrong password → inline error |
| Login & session (deep) | `login-session.spec.ts` | session guard redirect · Forgot-Password modal (no OTP) · Sign-Up link · logout (gated) |
| Screen shell | `shell.spec.ts` | header + nav rail on every screen |
| Katchup compose | `katchup-compose.spec.ts` | open a chat → open composer → enter Subject (BR-K01) + message; gated send + recall (green) |
| Katchup message actions | `katchup-actions.spec.ts` | sender bell menu → Delete (confirm) and Edit (resend + Edited marker, BR-K03), self-cleaning (gated) |
| Settings theme | `settings-theme.spec.ts` | Personalize → change KPost layout theme → Apply → verify active → restore original (gated, self-restoring) |

## Deep write flows (planned — gated, need live tuning)

- Katchup group / confidential-copy / attachments (needs 3 QA accounts + recording)
- KMail composer: open → recipient/subject → send (gated) → verify in Sent → delete; reply, drafts
- Settings font + notifications: change through the UI → verify applied → restore (theme is built)
- Profile: Edit Profile → change About → Update → verify → restore
- Contacts: search → add → block → unblock → remove (inside the Katchup rail)
- Kall: schedule → verify in log → reschedule (status flips) → delete (direct-call ring stays UI-only)
- KDiary: create event → verify → delete (reached from inside Katchup)

