# UI write-flow plan — every module, mined selectors, gating, self-clean

The read-only UI is covered and green on live: `screens.spec.ts` (deep check sweep on every screen),
`navigation.spec.ts`, `shell.spec.ts`, `login.spec.ts`, and the Katchup composer (`katchup-compose.spec.ts`,
3 tests green — safe compose + gated send + recall). This file is the plan for the **write** flows —
the interactions that create/modify data through the UI.

**Why write-flows are a separate track.** Every UI write selector on this test-id-less React SPA needs
one live tuning pass (a `codegen` recording), exactly as recall did. So each flow below is shipped
**gated behind a `*_UI_LIFECYCLE` flag** (never runs on a default run, cannot file a false bug) and is
**self-cleaning** (the account ends as it started). The selectors are mined from the frontend
(`D:\KPOST_PROJECTS\KPOST_REACTJS_2023_V1`) — the same source `docs/ui-screens.md` maps — so tuning is
a verification pass, not a rediscovery.

**Hard rule (persists across every flow):** every write targets only the 6 QA PERSONAL accounts
(`Qatesting@`..`Qatesting6@kpostindia.com`); never another user's data. Enforced structurally by the
conversation being opened by `testData.victimKpostId` (our 2nd QA account).

## Tuning loop (per flow)

```
1. npx playwright test --project=setup           # refresh the saved session (.auth/user.json)
2. npx playwright codegen https://account.kpostindia.com/katchup   # record the real clicks
3. reconcile the recorded selectors against the spec below
4. KATCHUP_UI_LIFECYCLE=true npx playwright test <spec> --project=chromium --headed
5. green → remove the FIRST-RUN NOTE from the spec header
```

Validated patterns (hold across the whole app, proven by recall going green):

- a **conversation row**'s element `id` is the counterpart's KPOST ID — `page.locator('[id="<kpostId>"]')`
- the **composer** is the Quill editor `.ql-editor[contenteditable="true"]` — `keyboard.type`, never `.fill()`
- a **message** is a DOM element whose `id` is its msgID and which carries its own action trigger
- the **loader overlay** `.loader-overlay` intercepts clicks while the SPA loads — wait for `hidden`
- the **send** button is the icon button in `#ChatTop` (`getByRole('button').filter({hasText:/^$/})`)

---

## 1. Katchup — sender message actions · `katchup-actions.spec.ts` (BUILT, gated, needs tuning)

Gate: `KATCHUP_UI_LIFECYCLE=true`. The sender's **bell menu** (`NotificationsNoneIcon` on a message we
sent) is the `bellIconContent` array in `Katchup/bubble/KatchupMessage/KatchupMessage.js` and offers:
**Edit · Recall · Note · Reminder · Transfer · Forward · Forward-with-thread · Copy · Save · Delete**.
Recipient actions (`replyIconContent`, from the ReplyIcon on a received message): **Reply · Comment ·
Clarify · Transfer · Forward · Copy · Save · Delete**.

| Action   | Flow (all self-cleaning)                                                                                                      | Status                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Recall   | send → bell → `menuitem Recall` → menu closes (unsend, FR-K10/BR-K03)                                                         | ✅ green (compose spec) |
| Delete   | send → bell → `menuitem Delete` → dialog "Delete Message" → `button Confirm` → gone                                           | built, tune             |
| Edit     | send → bell → `menuitem Edit` → composer reopens pre-filled → edit body → resend → `Edited` marker (BR-K03) → delete to clean | built, tune             |
| Save     | send → bell → `menuitem Save` (`handleSaveButtonClickBell([msgID])`) → verify in Saved → unsave                               | plan                    |
| Note     | send → bell → `menuitem Note` → note modal → add → verify → remove                                                            | plan                    |
| Reminder | send → bell → `menuitem Reminder` → reminder modal → set → verify → clear                                                     | plan                    |
| Forward  | send → bell → `menuitem Forward` → pick recipient (2nd QA acct) → send → recall/delete both                                   | plan (complex payload)  |
| Transfer | send → bell → `menuitem Transfer` → transfer target → confirm → clean up                                                      | plan                    |

Delete-confirm dialog text: `"Do you want to Delete this Message? Please confirm"`, buttons `Cancel` /
`Confirm`. Edit reopens the composer via `setThreeDat({writeMessage:true})` + `EditMsg:true`, same
`#ChatTop` send button.

## 2. Katchup — group, confidential copy, attachments (plan)

- **Group create → send → members**: create group (mints `groupKpostID` `qab###@kpostindia.com`), open
  its conversation, send, verify per-recipient receipt, then `removeGroupMember` → `deleteGroup`
  (delete requires removing all members first — a known 400 otherwise). API-proven in
  `group/feature.spec.ts`; the UI flow mirrors it.
- **Confidential copy** (messageType 14): compose → add a visible Copy + a hidden Confidential recipient
  → send → assert the confidential recipient is hidden from the others (NFR-SEC02). Needs 3 QA accounts.
- **Attachments**: compose → attach (S3 presigned upload) → send → verify thumbnail → delete. The
  attachment reads are keyed by a real `uuid` only a completed upload produces.

## 3. KMail — compose/send · `WriteMail/WriteMail.js`, screen `Kmail/Kmail.js` (plan)

Gate: `KMAIL_UI_LIFECYCLE=true`. API lifecycle is 5/5 green (`kmail-flow.md`): New mail issues a
`kmailID`; recipient model is `toAddress` (TO) + `ccList` (COPY) + `bccList` (CONFIDENTIAL, hidden).
UI flow: `/kmail` → compose → recipient (2nd QA mailbox) + subject + body → send → verify in Sent →
delete/recall. `WriteMail.js` is a large component — record it fresh; the API contract is the truth
for field names. Also: reply, forward, draft save/delete, folders.

## 4. Settings — theme · `settings-theme.spec.ts` (BUILT, gated, high-confidence)

Gate: `SETTINGS_UI_LIFECYCLE=true`. The safest UI write (cosmetic, own-account, self-restoring) and
already API-backed (`changeTheme` 2/2 green). The selectors are unusually stable for this app, so it
needs little tuning: the swatches are real `<button class="k-color-swatch" aria-label="<theme>">`, the
selected one carries `k-color-swatch--active` + a `✓` (`.k-color-swatch-check`), the commit button is
labelled **"Apply Theme"**, and the section opens from the **"Personalize"** nav item.

Built flow (self-restoring, never hard-codes the theme): open Personalize → read the `--active` swatch's
`aria-label` (the original) → click a **different** swatch → Apply Theme → assert the chosen swatch is
now `--active` → click the original by its `aria-label` → Apply Theme → assert the original is `--active`.

Still to add here: **font** and the three **notification** toggles (change → verify → restore) — same
gate, same self-restoring shape. Chat variant buttons ("Classic" is disabled; "Bubble" active) are a
`localStorage` write only.

## 5. Profile — edit · `UserProfile/UserProfile.js`, `Settings/About/*` (plan, self-restoring)

Gate: `PROFILE_UI_LIFECYCLE=true`. API lifecycle 5/5 green (edit About/designation → read back →
restore). Mined selectors:

- "Edit Profile" button (UserProfile line 328); inline edit pencils `.icon-KP_236_Edit` per section
- About editor: `textarea[placeholder="Write about yourself..."]`, save button label **"Update"**

Flow: open `/userprofile` → Edit Profile → change About → Update → verify shown → restore original.

## 6. Contacts — add / block / search (plan)

Gate: `CONTACTS_UI_LIFECYCLE=true`. API lifecycle green (add → verify → delete; block → unblock). The
contact list/search lives inside the Katchup and Kall screens (no standalone `/contacts` route). Flow:
search a 2nd QA account → add → verify in list → block → unblock → remove. Selectors need recording
(the add/block controls are inside the Katchup contact rail).

## 7. Kall — schedule call (plan, UI-only for the ring)

Gate: `KALL_UI_LIFECYCLE=true`. API lifecycle 12/12 green; BR-C01 (Scheduled → ReScheduled) confirmed.
`initiateKall` rings a real device, so the **direct-call** UI stays assertion-only (open dialer, assert
controls — do not place). **Schedule** is safe: `/kall` → schedule → title/date/time/participant (2nd QA
acct) → save → verify in log → reschedule (status tag flips) → delete. Selectors from `kall-flow.md` +
recording.

## 8. KDiary — event (plan)

Gate: `KDIARY_UI_LIFECYCLE=true`. Reached from inside Katchup (no standalone `/kdiary` route). API green
(`createEvent` → `deleteEvent`, id field is `eventID`). Flow: open diary → create event → verify →
delete.

---

## Status summary

| Track                                                        | State                                                           |
| ------------------------------------------------------------ | --------------------------------------------------------------- |
| Read-only UI (all screens)                                   | ✅ green on live — deep check sweep, navigation, shell, login   |
| Katchup compose + recall                                     | ✅ green on live (`katchup-compose.spec.ts`)                    |
| Katchup Delete + Edit                                        | built, gated, needs one tuning pass (`katchup-actions.spec.ts`) |
| Katchup group/copy/attach                                    | planned — selectors mined, needs 3 QA accts + recording         |
| KMail / Settings / Profile / Contacts / Kall / KDiary writes | planned — API-proven, UI selectors mined, need recording        |

Every planned write flow already has a **green API lifecycle** proving the operation works on live; the
UI track proves the _screen_ drives that same operation. Nothing here runs on a default run, and nothing
here can file a bug until a person sets its flag and tunes it.
