# UI build plan — complete frontend map + per-module test plan

The authoritative build reference for finishing the UI test suite, grounded in a **complete frontend
analysis** (`D:\KPOST_PROJECTS\KPOST_REACTJS_2023_V1\src`, routes in `MenuRoutes.js`) and the KPost
documents (CLAUDE.md §1–4: the four documented modules Signup/Login, Katchup, Kall, KMail as 55 FRs +
9 BRs). Per module: the real selectors, the test approach, FR traceability, and status.

## Routing facts that shape the plan (from the analysis)

- **`/kdiary` is commented out** and **`/writemail` renders `Kmail`** — the standalone `WriteMail`
  component is unrouted. The **KDiary UI is the `Diary` component** (`components/Katchup/components/
Diary/Diary.js`), which also mounts inside the KMail/Kall/Home right rails, so it **is** testable.
- **`/kdoc` renders `KOS`** — K-AI, Kompose (KWord), KPresenter are active; 5 sub-tools are Coming Soon.
- Almost no `data-testid`s: tests match **`icon-KP_*` classes + visible `t("…")` text**. Modals are all
  `common/ModalComponent` (title = `Title` prop, submit = a `Button` in `Content`). Flow completion is
  best asserted on the **react-toastify** success copy.

## Definition of done (per UI module) — same 5 layers as an API module

1. Screen renders + key controls present (cross-browser). 2. The 9-check catalogue runs (already, via
   the screen sweep). 3. Every feature flow driven — gated (`*_UI_LIFECYCLE`) + self-cleaning for writes.
2. Negative/validation UI. 5. Valid bugs filed to KPost UI → Ayyappan on the right component.

## Build order (API order, every module deep)

Katchup (done) → **KMail → Kall → KDiary → Settings → Profile → Contacts → Group → Home →
verticals (KOS/KCloud/KBooking/KNews/E-Com/KDirectory) → Admin (needs a business company)**.

---

## Katchup — `/katchup` ✅ (reference module, mostly green on live)

Green: compose · send · recall · Delete · Edit · Save · Copy · Reply · Comment · Clarify · read
receipts (two-session) · Note · Reminder · Forward · search · Cc/Confidential/Bulk (3-account). Tail:
Transfer (hover flake), Forward-with-thread (covered by Forward), Recall&Repost (api-only). Full status
in `docs/KATCHUP-UI-COVERAGE.md`. **Key learned selectors reused everywhere** (`tests/e2e/support/
katchup.ts`): menu items match by **substring** (icon-glyph prefix); **send = press Enter** in the
editor (`WriteMessage` handleKeyDown); received-message conversation opened by subject; unknown-contact
rows not keyed by id.

---

## 1. KMail — `/kmail`, compose via `WriteMailPage.js` (FR-M01..M09, BR-M01)

Root `.kmail-layout-shell`; header `.icon-KP_03-KMail.Katchup_Icon` + `.Katchup_Name`. Left nav tabs
(`Kmail-tab`): "Recents" / "Contacts" / "Status of Mails".

| Feature                  | Selectors                                                                                                                                                                                                | Approach                                        | FR     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------ |
| Screen render            | `.kmail-layout-shell`, tabs                                                                                                                                                                              | read-only ✅                                    | —      |
| Compose → **send**       | To `input[name="to"].subjectTextboxKmailTO`; Subject `.toInput` (maxlen 70); body Quill placeholder `t("Type your mail here")`; **Send** `.post_button_size` (`.icon-KP_3164`) `onClick=PostMail(false)` | gated `KMAIL_UI_LIFECYCLE`, self-clean (delete) | FR-M01 |
| Priority                 | chip `.draftLow` → `t("Mail Priority")` icons `.icon-KP_76/77/78`                                                                                                                                        | gated                                           | —      |
| Attachment               | `input[type=file]#fileInput` behind `.icon-KP_36-Attach`                                                                                                                                                 | gated (file)                                    | FR-M03 |
| Save draft               | `.icon-KP_95-Write-Mail-Temp` `t("Save Draft")` → toast `"Mail Saved to Draft"`                                                                                                                          | gated, self-clean                               | —      |
| Copies (Cc/Confidential) | modal `MultipleContact` title `t("Mail With Copies")`                                                                                                                                                    | gated, 3-account (NFR-SEC02)                    | FR-M04 |
| Read/open mail           | Recents → `handleOpenMailChat` → `KmailMessage`                                                                                                                                                          | read-only                                       | BR-M01 |
| Drafts / status of mails | Status tab `StatusofMails`; per-mail `.icon-KP_29-Delete` / `.icon-KP_43-Fav`                                                                                                                            | gated                                           | —      |
| Validation               | empty subject → toast `"Subject cannot be empty"` / `"To or Subject or Mail Content Field cannot be empty"`                                                                                              | read-only, safe                                 | FR-M02 |

Coming-soon stubs: `toast.warn("Coming Soon..")` (KmailMessage.js:1474), group-info `alert("Group Info
Coming Soon")` — assert these where reached.

---

## 2. Kall — `/kall` (FR-C01..C09, BR-C01)

Root `.kall-layout-shell`; header `.icon-KP_05-Kall.Katchup_Icon`. Tabs (`Kmail-tab`): "Recents" /
"Contacts" / "Kool Kall".

| Feature                  | Selectors                                                                                                                                                                                                                                                                                                                               | Approach                                            | FR     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------ |
| Screen render            | `.kall-layout-shell`, 3 tabs                                                                                                                                                                                                                                                                                                            | read-only ✅                                        | —      |
| Call log / Recents       | Recent tab → select entry → `KallHistory`                                                                                                                                                                                                                                                                                               | read-only                                           | FR-C08 |
| **Direct call UI**       | Contacts → click contact → `KallModal` (title `t("Kall Info")`); audio `.icon-KP_240-Kall01`, video `.icon-KP_159-facecall`                                                                                                                                                                                                             | **assert-only, DO NOT place** (rings a real device) | FR-C05 |
| **Schedule (Kool Kall)** | Kool Kall tab → `.create_button`/`.create_font` (`.icon-KP_45-Add` + `t("Create")`) → `CreateKallModal` title `t("Create Kool Kall")`; radio `One Time`; `t("Meeting Title")` placeholder `t("Enter Meeting Title")`, `t("Date")`, `t("From")`/`t("To")`, `t("Invite Participants")`; success toast `t("Meeting Created Successfully")` | gated `KALL_UI_LIFECYCLE`, self-clean               | FR-C01 |
| **Reschedule**           | edit existing → modal title `t("Edit Kool Kall")` → toast `t("Meeting Edited Successfully")` (status Scheduled→Rescheduled)                                                                                                                                                                                                             | gated                                               | BR-C01 |
| Repeated meeting         | radio `Repeated` → `t("Repeat")` Daily/Weekly/Monthly + preferred weeks/days                                                                                                                                                                                                                                                            | gated                                               | FR-C02 |

---

## 3. KDiary — the `Diary` component (reached inside Katchup/KMail/Kall/Home rails)

Root `.Dairy-Container`; header `.ecomm_font` = `t("Diary")`.

| Feature               | Selectors                                                                                                                                                                                                                                                                                         | Approach                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Render                | `.Dairy-Container`, `.Diary-Percentage`                                                                                                                                                                                                                                                           | read-only                               |
| Date filter           | `select.Dairy-DateSelect` (Today / Selected Date) → `input[type=date].DiaryInput`                                                                                                                                                                                                                 | read-only                               |
| **Create event**      | `button.btn.btn-dark.rounded-pill` ("+ Add") → modal title `"KDiary"`; tab "Add Schedule"; radio One Time/Repeated; `.DiaryInput` placeholder `"Enter Title"`, `.DiaryTextArea` `"Enter Description"`, Date, Priority select; **Save** `.DiarySaveBtn` → toast `"Schedule created successfully!"` | gated `KDIARY_UI_LIFECYCLE`, self-clean |
| Task status / remarks | `.Diary-TaskCard` → `.Diary-TaskRightBtn` → Remarks modal `"KDiary Remarks"`, `.DiaryRemarksSubmitBtn`                                                                                                                                                                                            | gated                                   |
| Delete event          | Remarks → "Delete Task" → `window.confirm("Delete this task?")` (page.on('dialog'))                                                                                                                                                                                                               | gated (self-clean)                      |
| Add report            | modal tab "Add Report"                                                                                                                                                                                                                                                                            | gated                                   |

---

## 4. Settings — `/settings`

Root `.settings-theme-shell` + `.settings-theme-nav-panel`. Nav (`Settingdetails.js`) has collapsible
groups; each sub-item is `.dropdownnames` with an `icon-KP_*` + `t("…")` label.

| Group → item                                               | Selectors                                                                                                                               | Approach                                            |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| General → **Personalize** (theme)                          | `t("Personalize")` `.icon-KP_266_Personalize`; swatches `button.k-color-swatch[aria-label]`, `.k-color-swatch--active`, **Apply Theme** | ✅ built (`settings-theme.spec.ts`), self-restoring |
| General → Notification                                     | `t("Notification")` `.icon-KP_100-Notification` toggles                                                                                 | gated, self-restore                                 |
| Profile Creation → About                                   | `t("About")` → editor placeholder `"Write about yourself..."`, "Update"                                                                 | ✅ built (profile-edit)                             |
| Profile Creation → Basic/Contact/Education/Experience      | `t("Basic Information")` etc. → per-screen forms                                                                                        | gated, self-restore                                 |
| KMail → Signature / Letter Head / Instant Reply / Vacation | `t("Mail Signature")` `.icon-KP_104-Signature`, etc.                                                                                    | gated, self-restore                                 |
| General → Change Password / Change Mobile                  | forms — **assert only, never submit**                                                                                                   | read-only                                           |
| My Account → Delete My Account                             | `Deleteaccount` — **assert only, never submit**                                                                                         | read-only                                           |
| Blocked Contacts                                           | `t("Blocked Contacts")` → list + Unblock                                                                                                | ✅ partly (contacts.spec)                           |
| Business items                                             | `toast.info("This module is currently in progress.")`                                                                                   | read-only assert                                    |

Each sub-screen is its own `components/Settings/<Name>/` component — drill in per-screen for field
selectors. ~24 sections; most are render + a safe self-restoring write.

---

## 5. Profile — `/userprofile` ✅ (screen + About-edit built)

Root shows on `show`; cover `.profile_cover_background`. Three-dot `.icon-KP_144---More-Vertical.more_back`
→ dropdown: `t("Change Cover Picture")`, `t("Change Profile Picture")` (`#ImgInput`), `t("Share")`,
logout (toast `"Logout successfully"`). Section add/edit: `.icon-KP_45-Add` / `.icon-KP_236_Edit`.
Remaining: image change (gated), Share modal, per-section edits.

---

## 6. Contacts ✅ / 7. Group 🟡 (inside Katchup) — built (see `contacts.spec.ts`, `group.spec.ts`)

Contacts: rail list + block/unblock (built). Group: create modal (built). Group add/admin/rename/delete
and Contacts add remain (nested rail triggers — need recording).

---

## 8. Home / Dashboard — `/home`

Root `homeWeblasccs`. `HomeDashboard` header `.icon-KP_01-Home.Katchup_Icon`; tabs Recents/Contacts;
`RecentMessage` has several `alert("… Coming Soon")` stubs. Approach: screen render + recent-message
panel + nav — mostly read-only (the writes are Katchup/KMail flows already covered).

---

## 9. Verticals

| Module      | Route         | Key selectors                                                                                                                                   | Approach                               |
| ----------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| KOS/KDoc    | `/kdoc`       | `.settings-theme-shell`; tools K-AI/Kompose/KPresenter; Coming-Soon sub-tools render `🚀 … Coming Soon`                                         | screen + assert coming-soon states     |
| KCloud      | `/kcloud`     | `.ecomm_font` `t("Kloud Data & Storage")`; `t("Buy")`, `t("Documents")`, `t("Clear All Data")`                                                  | screen + read-only (buy is mock)       |
| K-Booking   | `/kbooking`   | `.icon-KP_09-Travel`; seat `.icon-KP_134-Seater`; search→seats→passenger→ticket                                                                 | screen + search form (deep flow later) |
| KNews       | `/knews`      | `.jn-page`, `.jn-logo` "KNews", search `.jn-search-input` placeholder `"Search headlines…"`, `.jn-refresh-btn`; forward modal `t("Forward To")` | screen + search + forward (gated)      |
| K-ECommerce | `/e-commerce` | `.Grid_Templet`, `.ECommerce_Card` (opens external URL — do not follow)                                                                         | screen render only                     |
| KDirectory  | `/kdirectory` | `.background_colorss`; account-type icons; `t("Country")`/`t("Language")` + `t("Continue")`; SearchBar + advanced search                        | screen + search (read-only)            |

All 6 already run the deep check sweep (screen registry). This adds their feature flows.

---

## 10. Admin / UserManagement — `/usermanagement` ⏸ needs a business company (3 members)

`.comm_back` "Business User Management"; tabs Add New / Allocated / Unallocated; search
`input.search-input[placeholder="Search members..."]`; **Add user** modal `"Add Communication Channels"`
(Designation, KPOST ID, Mobile, First/Last Name, Gender → `t("ADD")`); Terminate / Reset Password /
Backup Admin / Bulk Upload modals. Blocked until a business company with 3 members exists (one
expendable) — the same account need the API Admin module has.
