# FRD v2.1 — proposed new requirements

Proposals only — not applied. These come from **orphan-classification (a)**: in-scope tests exercise a
feature the current per-module FRD has **no requirement for**. Each proposed requirement cites the
existing spec(s) as evidence the feature is real and already tested; adopting the requirement + linking
the spec (a `requirement` annotation) converts the orphan into verified coverage.

Orphan files whose module **is** already in the FRD (Katchup, Group, Kall, KMail, Signup/Login,
KDirectory) are **not** here — those are "feature-in-FRD, test not yet linked" and live in the
**Review links** sheet of `reports/rtm.xlsx` (approve → annotate). This file is only for features the FRD
doesn't cover at all.

Priority: P1 security/data-integrity + core account actions · P2 feature behaviour · P3 cosmetic.

---

## Settings — propose `FR-SET-001..013` (module absent from FRD)

Evidence: `settings-*.spec.ts` (19 files / 40 in-scope tests), `api/kpost/settings/*`.

| Proposed ID | Requirement                                         | Evidence spec                                                   | Priority |
| ----------- | --------------------------------------------------- | --------------------------------------------------------------- | -------- |
| FR-SET-001  | Change password (current→new, validation, re-login) | settings-change-password-validation.spec.ts                     | P1       |
| FR-SET-002  | Change registered mobile number (OTP re-verify)     | settings-change-mobile-number-functional.spec.ts                | P1       |
| FR-SET-003  | Delete account (confirm, irreversibility)           | settings-delete-account-functional.spec.ts                      | P1       |
| FR-SET-004  | Account recovery options                            | settings-account-recovery-functional.spec.ts                    | P1       |
| FR-SET-005  | Notification preferences persist per channel        | api/kpost/settings/notifications-workflow.spec.ts               | P2       |
| FR-SET-006  | Personalization (theme, display) persists           | settings-theme-e2e.spec.ts, personalize-workflow.spec.ts        | P3       |
| FR-SET-007  | Data & storage view / management                    | settings-data-storage-functional.spec.ts                        | P2       |
| FR-SET-008  | Mail signature / letterhead edit                    | settings-letterhead-functional.spec.ts                          | P2       |
| FR-SET-009  | Digital card edit                                   | settings-digital-card-e2e.spec.ts                               | P2       |
| FR-SET-010  | Vacation auto-response                              | settings-vacation-response-functional.spec.ts                   | P2       |
| FR-SET-011  | Business company + bank details                     | settings-business-*.spec.ts                                     | P1       |
| FR-SET-012  | Other-mail (external mailbox) config                | settings-other-mail-functional.spec.ts                          | P2       |
| FR-SET-013  | Profile creation / instant reply                    | settings-profile-photo-e2e.spec.ts, settings-functional.spec.ts | P2       |

## Profile — propose `FR-PROF-001..006` (FRD only covers profile as FR-KD-005 read)

Evidence: `profile-*.spec.ts` (7 files), `api/kpost/profile/*` (4 files / ~27 tests).

| Proposed ID | Requirement                                       | Evidence                                           | Priority |
| ----------- | ------------------------------------------------- | -------------------------------------------------- | -------- |
| FR-PROF-001 | Edit own profile fields (name, designation, etc.) | profile-edit-e2e.spec.ts, profile-workflow.spec.ts | P2       |
| FR-PROF-002 | Profile image upload / change / share             | profile-actions-e2e.spec.ts                        | P2       |
| FR-PROF-003 | Device management (list, set primary, remove)     | api/kpost/profile/device-workflow.spec.ts          | P1       |
| FR-PROF-004 | Directory lookup of a user by KPost ID            | api/kpost/profile/directory-lookup.spec.ts         | P2       |
| FR-PROF-005 | Profile read returns own full details             | api/kpost/profile/reads-workflow.spec.ts           | P2       |
| FR-PROF-006 | Profile webview render                            | profile-webview-security.spec.ts                   | P3       |

## Contacts — propose `FR-CON-001..004` (FRD covers only FR-KD directory)

Evidence: `contacts-*.spec.ts`, `api/kpost/contacts/*` (7 files / 23 tests).

| Proposed ID | Requirement                        | Evidence                            | Priority |
| ----------- | ---------------------------------- | ----------------------------------- | -------- |
| FR-CON-001  | Contact lists create / manage      | contacts-lists-workflow.spec.ts     | P2       |
| FR-CON-002  | Add / edit / delete a contact      | contacts-workflow.spec.ts           | P2       |
| FR-CON-003  | Reference data (relationship/type) | contacts-reference-workflow.spec.ts | P3       |
| FR-CON-004  | Advanced contact search            | contacts-functional.spec.ts         | P2       |

## User Management — propose `FR-UM-001..003` (absent from FRD)

Evidence: `usermanagement-e2e.spec.ts` (company-admin user CRUD).

| Proposed ID | Requirement                          | Evidence                   | Priority |
| ----------- | ------------------------------------ | -------------------------- | -------- |
| FR-UM-001   | Company admin lists org users        | usermanagement-e2e.spec.ts | P2       |
| FR-UM-002   | Company admin creates / edits a user | usermanagement-e2e.spec.ts | P1       |
| FR-UM-003   | Company admin deactivates a user     | usermanagement-e2e.spec.ts | P1       |

## Home / Dashboard — propose `FR-HOME-001..002`

| Proposed ID | Requirement                        | Evidence                                                               | Priority |
| ----------- | ---------------------------------- | ---------------------------------------------------------------------- | -------- |
| FR-HOME-001 | Home shows Recents + unread counts | home-functional.spec.ts, api/kpost/dashboard/*                         | P2       |
| FR-HOME-002 | Global navigation / app shell      | platform-navigation-functional.spec.ts, platform-shell-screens.spec.ts | P2       |

## Business signup tiers — propose `FR-SL-033..035` (extends Signup/Login; rules are testable although signup submit is OTP-OOS)

Evidence: `signup-business*.spec.ts`, `signup-validation.spec.ts`, `signup-domain-validation.spec.ts`. See the Small≤250 / Medium 251–2000 / Large>1500 tier rules (Large floor unenforced, #833).

| Proposed ID | Requirement                                                  | Evidence                                                | Priority |
| ----------- | ------------------------------------------------------------ | ------------------------------------------------------- | -------- |
| FR-SL-033   | Business tier derived from member count (Small/Medium/Large) | signup-business-medium-large-e2e.spec.ts                | P1       |
| FR-SL-034   | Domain policy on business signup                             | signup-domain-validation.spec.ts, domain-policy.spec.ts | P2       |
| FR-SL-035   | Signup field validation                                      | signup-validation.spec.ts                               | P2       |

## Backlog / vertical modules — propose `FR-VERT-*` (scope decided 2026-10-13)

These have in-scope tests but no FRD module. Scope resolved by the owner:

| Area                    | Evidence                                                               | Decision                 | Action                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| KBooking / TA Wallet    | api/kpost/kbooking/feature.spec.ts                                     | LIVE (bugs #1013–1016)   | propose `FR-VERT-KBOOKING-001..` (P1 — payment callbacks)                                                       |
| KDiary                  | api/kpost/kdiary/\*, kdiary.spec.ts                                    | LIVE (#1017 IDOR)        | propose `FR-VERT-KDIARY-001..` (P1 — cross-tenant)                                                              |
| **KCloud**              | kcloud-functional.spec.ts                                              | **LIVE**                 | propose `FR-VERT-KCLOUD-001` — file storage upload/list/download (P2)                                           |
| **eCommerce**           | ecommerce-functional.spec.ts                                           | **LIVE**                 | propose `FR-VERT-ECOM-001` — commerce surface browse/transact (P2)                                              |
| **global-digital-card** | global-digital-card-functional.spec.ts                                 | **LIVE**                 | propose `FR-VERT-GDC-001` — shareable digital card renders + shares (P2)                                        |
| **child-safety-policy** | child-safety-policy-screens.spec.ts                                    | **LIVE**                 | propose `FR-VERT-CSP-001` — child-safety policy page reachable + content (P2)                                   |
| **interactions**        | platform-interactions-screens.spec.ts                                  | **LIVE**                 | propose `FR-VERT-INT-001..` — cross-feature interaction flows (P2)                                              |
| KOS / KWord / KAI       | kos.spec.ts, kword.spec.ts, kai.spec.ts, api/kpost/kos/feature.spec.ts | partial (metered)        | propose `FR-VERT-KOS-*` (P3) or OOS — owner's call                                                              |
| KNews                   | settings-knews-functional.spec.ts                                      | dead backend (per audit) | recommend OOS                                                                                                   |
| **KAD-document**        | kad-document.spec.ts                                                   | **OOS**                  | **done** — `@quarantine` applied with reason "out of scope: not a supported feature" (excluded from all levels) |

LIVE modules keep their existing module tag (`@verticals` / `@kos`) and stay in regression. KAD-document
is now `@quarantine`, so the runner excludes it from smoke/sanity/regression.

---

## Orphan classification summary

- **(a) feature exists, no FRD requirement → proposed above:** ~40 proposed requirements across Settings,
  Profile, Contacts, User Management, Home/Dashboard, Business-signup, and the (now LIVE-confirmed)
  vertical modules KBooking/KDiary/KCloud/eCommerce/global-digital-card/child-safety/interactions.
- **(b) duplicate / redundant (listed, not deleted):** full consolidation plan to follow after the
  review-link promotion pass. Candidate groups to confirm —
  - `katchup-screens.spec.ts` vs `katchup-functional.spec.ts` vs `katchup-continuous-send-e2e.spec.ts` (overlapping basic access/compose).
  - `contacts-screens.spec.ts` vs `contacts-functional.spec.ts`.
  - `profile-screens.spec.ts` vs `profile-functional.spec.ts`.
  - `kall-screens.spec.ts` vs `kall-window-functional.spec.ts` vs `kall-global-kool-kall-functional.spec.ts`.
  - API `*-workflow.spec.ts` vs the module `feature.spec.ts` in katchup/kmail/contacts (workflow = lifecycle, feature = BR — likely complementary, confirm).
- **(c) unclear — RESOLVED 2026-10-13:** KCloud, eCommerce, global-digital-card, child-safety-policy,
  interactions → LIVE (above). KAD-document → OOS (`@quarantine`).
