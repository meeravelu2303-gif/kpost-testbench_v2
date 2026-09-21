# UI evidence audit — what each UI flow accepts as proof

**GENERATED — do not edit.** Written by `tests/framework/ui-evidence.spec.ts`.

The master plan (§18): *do not equate button click, dialog close, URL change, or input value
with successful business behaviour.* The reason is circularity — every one of those signals is
produced by the same client that would be wrong if the feature were broken. Optimistic
rendering shows the bubble, a dialog closes on click rather than on response, and a URL changes
before anything is saved.

| | Count |
| - | ----: |
| UI specs | 37 |
| — that WRITE (gated behind a `*_UI_LIFECYCLE` flag) | 18 |
| — …carrying outcome evidence | **4** |
| — …with recorded evidence debt | 14 |

## What counts as outcome evidence

Each leaves the client that performed the action, which is the whole property.

| Kind | Why it counts |
| ---- | ------------- |
| API | API / state read-back — asks the server directly |
| CROSS_ACTOR | a second actor's own browser — asks a different session, which cannot share the sender optimistic state |
| RELOAD | UI read-back after a reload — throws away the client optimistic state and re-fetches |

## Per-spec

| Spec | Writes | Outcome evidence | Also relies on | Status |
| ---- | ------ | ---------------- | -------------- | ------ |
| `admin-screens.spec.ts` | yes | — | a URL change | DEBT (reason recorded) |
| `accessibility-axe.spec.ts` | — | — | — | read-only |
| `contacts.spec.ts` | yes | — | — | DEBT (reason recorded) |
| `crawl.spec.ts` | — | — | — | read-only |
| `cross-channel.spec.ts` | yes | API, CROSS_ACTOR | — | PROVEN |
| `group.spec.ts` | yes | API | an input holding a value | PROVEN |
| `home.spec.ts` | — | — | a URL change | read-only |
| `interactions.spec.ts` | — | — | — | read-only |
| `kall-features.spec.ts` | yes | — | an input holding a value | DEBT (reason recorded) |
| `kall.spec.ts` | — | — | a URL change | read-only |
| `katchup-actions-more.spec.ts` | yes | — | — | DEBT (reason recorded) |
| `katchup-actions.spec.ts` | yes | — | a menu or dialog closing | DEBT (reason recorded) |
| `katchup-compose.spec.ts` | yes | — | a menu or dialog closing, an input holding a value | DEBT (reason recorded) |
| `katchup-continuous.spec.ts` | yes | — | — | DEBT (reason recorded) |
| `katchup-copies.spec.ts` | yes | CROSS_ACTOR | a menu or dialog closing | PROVEN |
| `katchup-search.spec.ts` | — | — | an input holding a value | read-only |
| `katchup-two-session.spec.ts` | yes | CROSS_ACTOR | — | PROVEN |
| `katchup.spec.ts` | — | — | a URL change | read-only |
| `kdiary.spec.ts` | yes | — | an input holding a value | DEBT (reason recorded) |
| `keyboard-nav.spec.ts` | — | — | — | read-only |
| `kmail-compose.spec.ts` | yes | — | — | DEBT (reason recorded) |
| `kmail.spec.ts` | — | — | a URL change | read-only |
| `login-session.spec.ts` | yes | — | a URL change | DEBT (reason recorded) |
| `login.spec.ts` | — | — | a URL change | read-only |
| `navigation.spec.ts` | — | — | a URL change | read-only |
| `network-resilience.spec.ts` | — | — | — | read-only |
| `profile-actions.spec.ts` | yes | — | — | DEBT (reason recorded) |
| `profile-edit.spec.ts` | yes | — | — | DEBT (reason recorded) |
| `profile.spec.ts` | — | — | a URL change | read-only |
| `screens.spec.ts` | — | — | a URL change | read-only |
| `settings-sections.spec.ts` | — | — | — | read-only |
| `settings-theme.spec.ts` | yes | — | — | DEBT (reason recorded) |
| `settings.spec.ts` | — | — | a URL change | read-only |
| `shell.spec.ts` | — | — | — | read-only |
| `usermanagement.spec.ts` | yes | — | — | DEBT (reason recorded) |
| `verticals-features.spec.ts` | — | — | a URL change | read-only |
| `visual.spec.ts` | — | — | — | read-only |

## Evidence debt — write flows that cannot yet prove their outcome

Each entry says what is missing and how it would be closed. Removing an entry is the
definition of done for that flow.

| Spec | Why, and the path to closing it |
| ---- | ------------------------------- |
| `katchup-actions.spec.ts` | Delete, Save and Copy each assert only that the menu or confirm dialog closed — the exact signal the master plan forbids. Delete has a ready path: the plan names "delete → read-back proves absence", and the API read-back must run as the SENDER, which displaces that account's browser session (the Phase 8 defect), so it has to be the last action of the test or use a re-auth. |
| `katchup-actions-more.spec.ts` | Note, Reminder, Transfer and Forward assert the sub-flow modal was driven, not that the resulting message exists. Each has an API counterpart already driven by katchup/feature.spec.ts, so the read-back is available; it needs the same sender-session care as Delete. |
| `katchup-compose.spec.ts` | Send and recall are asserted in the sender's own view. Recall is recipient-side by definition (BR-K03), so the meaningful evidence is the RECIPIENT's read — which cross-channel.spec.ts already demonstrates and this spec predates. |
| `katchup-copies.spec.ts` | The confidential-copy concealment IS asserted across three real browser sessions, which is strong cross-actor evidence; it is listed here only because the SEND itself is confirmed in the sender's own view. Lower priority than the rest. |
| `katchup-continuous.spec.ts` | Reproduces "the second send fails without a refresh". Its signal is deliberately the failed network call rather than a read-back, because the defect is that the send never happens. Adding an API read-back would confirm absence but not the freeze; both would be better. |
| `kall-features.spec.ts` | The schedule form is driven but Submit is codegen-blocked (the participant picker is a nested custom widget), so there is no created call to read back yet. The plan names "Kall schedule → call record exists with correct participants"; the API lifecycle already proves that half. |
| `kmail-compose.spec.ts` | Send is confirmed by the toast and the compose form clearing. The plan names "mail send → transaction state exists"; the kmail API lifecycle can read the sent mail back by kmailID. |
| `contacts.spec.ts` | Block and unblock are asserted through the blocked-contacts panel, which is the same client. The API block/unblock lifecycle is green, so a read-back of getblockContactDetails is available. |
| `kdiary.spec.ts` | The diary UI is reached from inside the rails and the write is asserted by the toast. The API lifecycle proves createEvent/deleteEvent, so an eventID read-back is available. |
| `profile-actions.spec.ts` | Read-only assertions on the profile sections; the two write flows it would cover are codegen-blocked (hover-revealed pencils). No write is performed, so there is nothing to read back yet — it is listed for completeness rather than as debt. |
| `profile-edit.spec.ts` | About edit reads the value back in the UI and restores it. That is a genuine read-back but through the same client; getUserProfileUsingKpostID would make it independent. |
| `settings-theme.spec.ts` | A theme change is client-side by nature and is restored by the test. getPersonalize would confirm it persisted server-side, which is the part currently unproven. |
| `usermanagement.spec.ts` | Deliberately stops before completing the add — finishing it provisions a real member account, which is gated at the API level. Nothing is written, so there is nothing to read back. |
| `login-session.spec.ts` | Logout is asserted by the redirect to /login. Here the redirect IS the behaviour rather than a proxy for it, but the session being dead server-side is the stronger claim and is unproven. |
| `admin-screens.spec.ts` | Gated behind ADMIN_UI_LIFECYCLE because the SSO seed writes a token into the admin origin, but the spec itself only navigates and asserts each screen mounted — it performs no application write, so there is no outcome to read back. It is blocked for a separate reason: no dedicated admin UI test deployment exists, and the plan is explicit that automated UI tests must not be pointed at the production admin UI merely because it responds. |
| `katchup-two-session.spec.ts` | Carries cross-actor evidence (a real second browser receives the message), so it is NOT debt. Listed only because its own composer entry point is blocked for a non-contact — the same limit cross-channel.spec.ts works around with a declared API-seeded precondition. |
