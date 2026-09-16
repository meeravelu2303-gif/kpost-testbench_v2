# FRD Requirement Coverage — the 6 per-module FRDs

Source of truth: the six per-module FRDs in `D:\Kpost Documents` (2026-09-16), ≈165 FRs across six
modules (Katchup includes the `FR-GMSG` Group-Messaging sub-scheme). This file is the FR→bench-coverage map — the answer to "which requirement is tested, where,
and what is still a gap". It is maintained by hand alongside the `requirements` tags on the endpoint
definitions and specs (CLAUDE.md §4, §8). Status legend:

- **COVERED** — an API and/or UI test exercises it (named in the row).
- **GAP** — in scope, documented, not yet covered → a to-do line item.
- **OUT-OF-SCOPE** — deliberately excluded, with the reason (OTP/signup, mobile-only, KDOC).
- **PARTIAL** — some of the FR is covered; the rest is noted.

Counts: **165 FRs** (incl. `FR-GMSG-001..012`, Group Messaging = §8 of the Katchup FRD) — COVERED
~110, GAP ~25, OUT-OF-SCOPE ~30 (refined as the to-do items land). Endpoint-level `requirements`
tags currently reference 24 FR ids; most FRs are UI-flow requirements mapped to specs in the tables
below rather than to a single endpoint.

**Group Messaging — `FR-GMSG-001..012`** (compose in group thread, subject auto-suggest, Post To
All/Selected Members targeting, sent-message display). Bench: group send is COVERED at the API level
(`katchup/send.api.ts` → `FR-GMSG-005`); the Post-To All-vs-Selected UI targeting is a GAP.

---

## Signup & Login — `FR-SL-001..032` (32)

| FR             | Title                                                     | Status       | Where / reason                                                                      |
| -------------- | --------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------- |
| FR-SL-001..005 | Sign-up entry, account type, country, language, domain    | OUT-OF-SCOPE | signup; accounts created by hand                                                    |
| FR-SL-006..008 | Mobile entry, OTP, confirm                                | OUT-OF-SCOPE | OTP-gated on live (no bypass)                                                       |
| FR-SL-009..015 | Name, gender, DOB, email, PIN address auto-fill, policies | OUT-OF-SCOPE | signup; PIN auto-fill = `getAddressUsingPincode` (common, COVERED as a read)        |
| FR-SL-016..018 | KPOST ID create, suggestions, reject taken                | PARTIAL      | `kpostIdExist`/`kpostIDsuggestionList` COVERED as reads; signup submit out-of-scope |
| FR-SL-019..022 | Password strength/confirm, submit, success                | OUT-OF-SCOPE | signup submit (OTP)                                                                 |
| FR-SL-023      | Select country on login                                   | COVERED      | `login.spec.ts` / `tests/e2e/login.spec.ts`                                         |
| FR-SL-024      | Enter KPOST ID / mobile for login                         | COVERED      | `login.api.ts` `fetchUserDetails` + login UI                                        |
| FR-SL-025      | Identified user on password screen                        | COVERED      | `tests/e2e/login.spec.ts` (step-2)                                                  |
| FR-SL-026      | Authenticate password and sign in                         | COVERED      | `login-flow.spec.ts` (+ enumeration rule)                                           |
| FR-SL-027..029 | Notification / contacts / battery permissions             | OUT-OF-SCOPE | native mobile-app permissions                                                       |
| FR-SL-030      | Set primary device                                        | OUT-OF-SCOPE | device designation, OTP-gated (`device.api.ts`, blocked)                            |
| FR-SL-031      | Optional profession entry                                 | PARTIAL      | profile designation write (API lifecycle)                                           |
| FR-SL-032      | Home with Recents + navigation                            | COVERED      | `home.spec.ts` / `shell.spec.ts` / `navigation.spec.ts`                             |

## Katchup — `FR-KU-001..057` (57)

| FR                 | Title                                                                                                                     | Status            | Where / reason                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KU-001          | Access Katchup from dashboard                                                                                             | COVERED           | `katchup.spec.ts` / `navigation.spec.ts`                                                                                                     |
| FR-KU-002..003     | Open thread, compose, Subject + body                                                                                      | COVERED           | `katchup-compose.spec.ts` (BR-K01 subject) + API lifecycle                                                                                   |
| FR-KU-004          | Full-screen composer                                                                                                      | GAP               | UI-only; not asserted                                                                                                                        |
| FR-KU-005          | Discard compose                                                                                                           | GAP               | UI-only; not asserted                                                                                                                        |
| FR-KU-006          | Text formatting                                                                                                           | GAP               | UI-only (Quill toolbar)                                                                                                                      |
| FR-KU-007          | Tag Copies / Confidential Copies                                                                                          | COVERED           | `katchup-copies.spec.ts` (NFR-SEC02 hard-asserted) + API                                                                                     |
| FR-KU-008          | AI-assisted message generation                                                                                            | GAP               | K-AI compose in Katchup; API K-AI covered (KOS), composer path not                                                                           |
| FR-KU-009..016     | Attachments (picker, preview, caption, mixed, send)                                                                       | GAP               | blocked-with-reason (real file-picker upload)                                                                                                |
| **FR-KU-017..024** | **Disappearing / Secret Message** (access, mode, after-reading, schedule, active icon, sent icon, countdown, auto-delete) | **COVERED (API)** | `katchup/feature.spec.ts` — both modes (`isVanished` after-read + `secretMessageExpireTime` scheduled), gated; UI lock-icon flow = follow-up |
| FR-KU-025..026     | Action menu via bell / More                                                                                               | COVERED           | `katchup-actions.spec.ts` (`openBellMenu`)                                                                                                   |
| FR-KU-027          | Edit sent message                                                                                                         | COVERED           | `katchup-actions.spec.ts` (Edited marker) + API                                                                                              |
| FR-KU-028          | Recall sent message                                                                                                       | COVERED           | recall lifecycle (API green) + UI                                                                                                            |
| FR-KU-029..031     | Repost recalled / recall again / delete recalled                                                                          | PARTIAL           | recall + delete covered; repost variant partial                                                                                              |
| FR-KU-032          | Add note                                                                                                                  | COVERED           | `katchup-actions-more.spec.ts`                                                                                                               |
| FR-KU-033          | Set reminder                                                                                                              | COVERED           | `katchup-actions-more.spec.ts`                                                                                                               |
| FR-KU-034          | Transfer to external app                                                                                                  | COVERED           | `katchup-actions-more.spec.ts` (Transfer)                                                                                                    |
| FR-KU-035..038     | Forward (source hidden/revealed × with/without thread)                                                                    | PARTIAL           | Forward + Forward-with-thread covered; hidden/revealed variants → GAP (to-do 8)                                                              |
| FR-KU-039          | Copy content                                                                                                              | COVERED           | `katchup-actions.spec.ts`                                                                                                                    |
| FR-KU-040          | Save message                                                                                                              | COVERED           | `katchup-actions.spec.ts`                                                                                                                    |
| FR-KU-041          | Text-to-speech                                                                                                            | OUT-OF-SCOPE      | UI-only, no assertion (client TTS)                                                                                                           |
| FR-KU-042          | Delete message                                                                                                            | COVERED           | `katchup-actions.spec.ts` + API                                                                                                              |
| FR-KU-043..046     | Reply (AI), comment, clarify                                                                                              | COVERED           | `katchup-two-session.spec.ts` (Reply/Comment/Clarify)                                                                                        |
| FR-KU-047          | Report contact to KPOST admin                                                                                             | COVERED           | API report (feature flow)                                                                                                                    |
| FR-KU-048..057     | Received-message actions (More, transfer, forward×4, copy, save, TTS, delete)                                             | PARTIAL           | receive-side Reply/Comment/Clarify + delete covered; forward variants GAP                                                                    |

## Group — `FR-GC-001..008` + `FR-GM-001..016` (24)

| FR             | Title                                           | Status  | Where / reason                                              |
| -------------- | ----------------------------------------------- | ------- | ----------------------------------------------------------- |
| FR-GC-001..003 | Create group: name, add members, preview        | COVERED | `group.spec.ts` + `group/feature.spec.ts` (createUserGroup) |
| FR-GC-004..005 | Group photo select / crop                       | GAP     | UI image picker (codegen-wall)                              |
| FR-GC-006..008 | Final review, success toast, appears in Recents | COVERED | API create + UI create modal                                |
| FR-GM-001..002 | Access Group Info, admin view                   | PARTIAL | API reads; UI Group-Info render GAP                         |
| FR-GM-003      | Add member (header entry)                       | COVERED | API `addGroupMember` (lifecycle)                            |
| FR-GM-004..006 | Per-member KMail / Katchup / Kall quick actions | GAP     | Group-Info row actions (UI)                                 |
| FR-GM-007      | Group Management three-dot menu                 | GAP     | UI options sheet                                            |
| FR-GM-008      | Edit group name/photo                           | COVERED | API rename (lifecycle)                                      |
| FR-GM-009..010 | Add members via options + search                | COVERED | API add + `myContacts` search                               |
| FR-GM-011      | Remove member                                   | COVERED | API `removeGroupMember` (lifecycle)                         |
| FR-GM-012      | Add admin (promote)                             | COVERED | API `addOrRemoveAdminAccess` (make admin)                   |
| FR-GM-013      | Remove admin (demote)                           | GAP     | to-do item 6 — assert demote                                |
| **FR-GM-014**  | **Min-one-admin rule on Exit**                  | **GAP** | to-do item 6 — sole admin blocked until another added       |
| FR-GM-015      | Exit group                                      | COVERED | API leave (lifecycle)                                       |
| FR-GM-016      | Activity feed for admin actions                 | GAP     | system-message assertion                                    |

## Kall — `FR-KL-001..009` (9)

| FR        | Title                             | Status       | Where / reason                         |
| --------- | --------------------------------- | ------------ | -------------------------------------- |
| FR-KL-001 | Create scheduled Kall             | COVERED      | `kall/feature.spec.ts` `scheduledKall` |
| FR-KL-002 | Add participants                  | COVERED      | `modifyKallMembers`                    |
| FR-KL-003 | Reschedule                        | COVERED      | `reScheduleKall`                       |
| FR-KL-004 | Status tag on reschedule (BR-C01) | COVERED      | senderKallStatus 6→7 asserted on live  |
| FR-KL-005 | Place direct call                 | COVERED      | `initiateKall` (gated)                 |
| FR-KL-006 | Call external (native contacts)   | OUT-OF-SCOPE | device dialing (mobile)                |
| FR-KL-007 | Contacts screen + count           | COVERED      | `kall-features.spec.ts` tabs           |
| FR-KL-008 | Maintain call log                 | COVERED      | `kallDashboard` / call-log reads       |
| FR-KL-009 | Record call timestamps            | COVERED      | call-log fields                        |

## KMail — `FR-KM-001..025` (25)

| FR             | Title                                     | Status       | Where / reason                                                   |
| -------------- | ----------------------------------------- | ------------ | ---------------------------------------------------------------- |
| FR-KM-001..002 | Open Write Mail, default fields           | COVERED      | `kmail-compose.spec.ts`                                          |
| FR-KM-003..004 | Contact list on To: tap, real-time search | COVERED      | UI compose (To autocomplete)                                     |
| **FR-KM-005**  | **Enforce single recipient in To:**       | **GAP**      | to-do item 5 — one TO, Cc for more (API model: toAddress+ccList) |
| FR-KM-006      | Add Cc via toolbar                        | COVERED      | API send `ccList`                                                |
| FR-KM-007..008 | Salutation dropdown + confirm             | COVERED      | settings saluation write                                         |
| FR-KM-009      | Subject line                              | COVERED      | API + UI compose                                                 |
| FR-KM-010..011 | Priority level + high-priority flag       | GAP          | to-do item 5 — assert `kmailPriority`                            |
| FR-KM-012      | Compose body                              | COVERED      | `kmail-compose.spec.ts`                                          |
| FR-KM-013      | Remove default signature block            | GAP          | to-do item 5                                                     |
| FR-KM-014      | Attach files                              | PARTIAL      | API attachment (AWS) covered; UI upload blocked-with-reason      |
| FR-KM-015      | Record/insert audio                       | GAP          | UI-only (mic)                                                    |
| FR-KM-016      | Font/formatting                           | GAP          | UI-only                                                          |
| FR-KM-017      | AI Assist                                 | GAP          | composer AI path                                                 |
| FR-KM-018..019 | Send + confirmation/reset                 | COVERED      | `kmail/feature.spec.ts` (FR-M01) + UI send                       |
| FR-KM-020      | Read receipts                             | COVERED      | API receipts (BR-M01)                                            |
| FR-KM-021      | Open with external app                    | OUT-OF-SCOPE | client/mobile interop                                            |
| FR-KM-022      | Add external recipients                   | PARTIAL      | API accepts external address; not driven live (real mail)        |
| FR-KM-023..025 | Transfer/share to Gmail/Outlook/Yahoo     | OUT-OF-SCOPE | client/mobile share-intent                                       |

## KDirectory — `FR-KD-001..006` (6) — NEW in scope

| FR        | Title                            | Status  | Where / reason                                        |
| --------- | -------------------------------- | ------- | ----------------------------------------------------- |
| FR-KD-001 | Display directory listing        | PARTIAL | overlaps company members / `myContacts`; to-do item 7 |
| FR-KD-002 | Search by name                   | PARTIAL | `globalSearch` / contacts search; map to FR-KD        |
| FR-KD-003 | Entry details (name/role/team)   | GAP     | to-do item 7                                          |
| FR-KD-004 | Total contact count              | GAP     | to-do item 7                                          |
| FR-KD-005 | View full profile                | PARTIAL | profile reads; directory-entry path to map            |
| FR-KD-006 | Launch Katchup/Kall from profile | GAP     | verticals KDirectory UI + cross-module launch         |

## KDOC — OUT-OF-SCOPE

No per-module FRD supplied; BRD §4.2 excludes it. The bench covers KWord/K-AI (KOS) at the API level
as a backlog module, but KDOC is not an FRD-traced module.
