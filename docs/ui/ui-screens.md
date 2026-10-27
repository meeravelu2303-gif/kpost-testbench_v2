# UI screens — the map the e2e tests are built from

The UI source of truth, the way the Excel workbook is the API's. Distilled from the live front-end
source at `D:\KPOST_PROJECTS\KPOST_REACTJS_2023_V1\src` (routing in `MenuRoutes.js`). Every screen
below lists the **stable selectors present at initial load** and the **control → action → API**
wiring a test can anchor on. Icons are `icon-KP_*` font classes whose name encodes their meaning
(full key: `src/Assets/icons/icomoon/style.css`).

## How the app is shaped (facts a test must respect)

- **Auth/session.** Login writes `localStorage.accessToken`, `refreshToken`, `Authuser` (JSON), and
  `deviceIdentity_primary`. Our `setup` project logs in and saves this as `storageState`.
- **Viewport.** Layout is width-gated (`<520` mobile, `<768` tablet, `<1200` desktop, else large).
  Columns carry `d-none d-xl-block`/`d-none d-xl-flex`, so **test at ≥1200px** (the browser projects
  default to 1280 — do not shrink below 1200 or the nav rail and side columns vanish).
- **Filler panels.** `/katchup`, `/kall`, `/home`, `/kmail` embed `<Knews>` and `<Ecommerce>` as
  right-column **empty-state fillers** before a chat/mail is opened, so `.jn-hero` / ECommerceList
  selectors appear on those screens at load — do not treat them as the screen's own content.
- **Chat variant.** `localStorage.katchup_chat_variant_v1` = `"bubble"` (default) or `"classic"`
  swaps which `KatchupMessage`/CSS module mounts. Pin it before deep Katchup/Home assertions.
- **Scope.** PERSONAL accounts only, so `/usermanagement` (admin) does not render for us; `/kdoc`
  (KOS) top level currently renders "Coming Soon". Both are documented but not asserted.

## Shared shell — Header (`containers/Header.js`)

Wraps every authenticated route via `<Outlet/>`. The side nav renders as an always-in-DOM icon rail
(collapsed) plus an expanded icon+label twin; the active item adds `iconbackgroundcolor` /
`background_icon`.

- **Brand / search:** `.header_brand_text.kpost` (text `KPOST`), `.header-search-text`
  (`Global Search`), `.header-search-hotkey` (`Ctrl+K`).
- **User chip / dropdown:** `.header-user-name`, `.header-user-role`; the dropdown rows include
  `Login History` (`getActiveSession`), `Profile` (→ `/userprofile`), `Change Theme`
  (`generalSetting/changeTheme`), `Logout` (`signupLogin/userLogout/`).
- **Nav rail** — one `div.icon-KP_XX … menu_icon_font` per destination, expanded twin carries the
  `.menu_font` label:

  | Icon class                  | Label      | Navigates to                   |
  | --------------------------- | ---------- | ------------------------------ |
  | `icon-KP_01-Home`           | Home       | `/home`                        |
  | `icon-KP_02-Write-Letter`   | WriteMail  | `/writemail`                   |
  | `icon-KP_03-KMail`          | KMail      | `/kmail`                       |
  | `icon-KP_04-Katchup`        | Katchup    | `/katchup`                     |
  | `icon-KP_05-Kall`           | Kall       | `/kall`                        |
  | `icon-KP_06-KDirectory`     | KDirectory | `/kdirectory`                  |
  | `icon-KP_295_Cloud-Storage` | KCloud     | `/kcloud`                      |
  | `icon-KP_88-Bus`            | KBooking   | `/kbooking`                    |
  | `icon-KP_15-Settings`       | Settings   | `/settings`                    |
  | `icon-KP_170---Admin-SMACC` | Admin      | `/usermanagement` (admin only) |

## Screens

Each header on the module screens is `.<moduleIcon>.Katchup_Icon` + `.Katchup_Name` with the module
name as text — a reliable "this screen mounted" anchor.

### /login — `components/auth/Login.js` (standalone, no Header)

Two steps. **Step 1:** `.login__wrapper`; heading `.login__heading` (`Sign in to your account`);
country `ReactSelect placeholder="Search country..."`; `input#username.login__input`
(`Enter KPOST ID / Mobile number`); `button.login__submit` (`Submit`) → `fetchUserDetails/` (or
`getCompanyDetails` for a 10-digit mobile). **Step 2:** `.login__user-card`, `img.login__avatar`
(`/profile/downloadProfileImage/{id}`), `input.login__input` (`Enter your password`),
`.login__pw-toggle`, `.login__forgot` (`Forgot Password ?`), `button.login__submit` (`Login`) →
`signupLogin/userLogin/` → `/home`. Forgot-password modal drives
`forgotPasswordOTPOrSentKpostIDSms/` → `validateOTP/` → `forgotPasswordUpdate/`.

### /home — `components/Home/MainHomePage.js`

- **Load:** `.homeWeblasccs`; left `HomeDashboard` header `.icon-KP_01-Home.Katchup_Icon` +
  `.Katchup_Name` (`Home`); tabs `Recents`/`Contacts` (`.slider-container3`, `.active-Recent`).
- **Actions:** open a Katchup chat → `katchupMessagesForSelectedContactID/`; open a mail →
  `selectedContactMails/`; recent sort → `dashboard/katchupDashboardMsg/`.

### /katchup — `components/Katchup/Katchup.js`

- **Load:** left header `.icon-KP_04-Katchup.Katchup_Icon` + `.Katchup_Name` (`Katchup`); tabs
  `Recents`/`Contacts`; search `input[placeholder="Search"]` with `.icon-KP_30-Search`,
  `.icon-KP_53-Mic-on`, `.icon-KP_225_Advanced-Search`.
- **Compose controls (`WriteMessage`):** `.icon-KP_36-Attach` (attach → presigned URL +
  `sendKatchupMsgMultiPart/`), `.icon-KP_227_Secret-Message` (secret), `.icon-KP_229_Copies1`
  (copies), `.icon-KP_226_Emoji`, `.icon-KP_98-Font-Style`; window `.icon-KP_310_Maximize-Full` /
  `.icon-KP_312_Minimize` / `.icon-KP_136-Close`.
- **Send / row actions:** plain send → `sendMessage/`; star → `markOrUnmarkImportantMessage/`;
  delete → `deleteKatchUpMessage/`; forward → `forwardKatchupMessageNew/`; recall → `recallMessage`;
  save → `saveKatchupMessages/`; unread badge → `getUnopenedMessagesCount/`.

### /kall — `components/Kall/Kall.js`

- **Load:** shell `.kall-layout-shell`; left header `.icon-KP_05-Kall.Katchup_Icon` + `.Katchup_Name`
  (`Kall`); tabs `Recents`/`Contacts`/`Kool Kall`; contact search `input[placeholder="Search"]`.
- **Actions:** select a contact → `initiateKall`; recents → `kallDashboard/`; today's scheduled →
  `todayKoolKall/`; schedule → `scheduledKall`; join → `joinScheduleKall`; frequent →
  `frequentKallContacts`. **History panel** quick-nav icons `.icon-KP_02-Write-Letter` /
  `.icon-KP_03-KMail` / `.icon-KP_04-Katchup` / `.icon-KP_05-Kall`; delete → `clearKallBykallIds`;
  history rows → `kallInfo`; end → `endIndividualKall`; status → `updateKallStatus`.

### /userprofile — `components/UserProfile/UserProfile.js`

- **Load:** cover `.profile_cover_background`; 3-dot `.icon-KP_144---More-Vertical.more_back`;
  `img.Main-Profile-image`; name `.name_font_profile`; role `.designation_font_profile`; stats
  `.number_font_profile` + `.ff_font_profile` (`Followers`/`Following`/`Contacts`); `.dcard_font`
  (`Edit Profile`); `.icon-KP_120-KShare.pShare_btn`; `.icon-KP_67-Camera.pChangePic_btn`.
- **Basic Information** card (`h5` `Basic Information`): `.icon-KP_54-Hang-fill` (phone),
  `.icon-KP_220---Pura` (email), `.icon-KP_57-Location-On`. Section tabs `About`/`Experience`/
  `Education`/`Other Activities`.
- **APIs:** mount → `getUserProfile/`; pic → `updateProfileImage/`; digital card → `getDigitalCard/`.

### /settings — `components/Settings/Setting.js`

- **Load:** shell `.settings-theme-shell`; nav `.settings-theme-nav-panel` (title `.ecomm_font`
  `Settings`); content `.settings-theme-content-panel` (defaults to `SettingProfile`). Section headers
  (`.profilestyle`): `Profile Creation`, `Digital Card Settings`, `General Settings`,
  `KMail Settings`, `KNews Settings`, `My Account`.
- **Sub-item → API (each `.dropdownnames`):** About (`updateAboutYourself/`), Basic Information
  (`updateBasicInformation/`), Contact Information (`updateContactInformation/`), Change Password
  (`changePassword`), Blocked Contacts (`getblockContactDetails`), Delete My Account
  (`sendAccountDeactivationOtp/` → `deactivateAccount/`), Digital Card
  (`updatePrivacySettingDetails`), Instant Reply (`saveOrUpdateCustomizedInstantReply`).

### /kmail — `components/Kmail/Kmail.js`

- **Load:** shell `.kmail-layout-shell`; list column `.col-xl-4`, content `.col-xl-8`; fillers
  `<KNews>`/`<Ecommerce>`.
- **APIs:** dashboard `getKmailDashboardMsg/`; open thread `selectedContactMails/`; content
  `sentAndInboxMailContent/`; send `postMail/` (+ `postMailMultiPart/`); draft `draftMail/`; delete
  `deleteKmailWithDeletedBy/`; star `setKmailAsImportant/`; unread `unOpenedMailCountBySenderID/`.

### /usermanagement — `components/UserManagement/UserManagement.js` (admin only, not in PERSONAL scope)

Cards `Add New`/`Channels`/`Allocated`/`Unallocated`; `input[placeholder="Search members..."]`;
`.table-container`. APIs under `/admin/*` (`userManagementDetails/{id}`, `addingUserByAdmin/`,
`terminateUser/`, `resetPassword`, …).

## The icon key

`src/Assets/icons/icomoon/style.css` is the authoritative name→glyph map (`.icon-KP_*:before`),
IcoMoon source `selection.json`. The class name encodes the meaning, so a test reads intent straight
from the class. Any `[class^="icon-"]`/`[class*=" icon-"]` element is an icon. The names the e2e
tests use are listed inline per screen above; the full KP_01–KP_321 range lives in `style.css`.

## Services layer → API (`src/Services/*.js`)

Each screen's actions map to a `Services/*.js` function with an explicit method + path — the
frontend's own record of which control calls which endpoint. Base URLs are in `ServiceURL.js`; note
the committed file points `EndPointURL`/`KmailEndPointURL` at **LAN IPs** (a dev build), and each
deployment talks to its own API hosts (the test front end `test.kpostindia.com` → `testingapi` /
`testkmail`; the live one → `devapi2` / `kmail5`). The bench drives **only the test front end**
(`BASE_URL`), and UI tests intercept by **path** (`**/katchup/sendMessage/`), never by origin. Per-file function
lists: `Login.js`, `Katchup.js`, `Kall.js`, `Kmail.js`, `Setting.js` (profile + `/admin/*`),
`Contacts.js`, `KOS.js`, `ECommerce.js`, `ThemeSettings.js` — see the frontend source for the full
per-function table.

---

# Front-end module map

How the React app boots, its route map and module inventory, and the K-Booking safety boundary.

## Module map: How the app boots and stays live

- `App.js` wraps everything in `<Router>` + a custom `SocketProvider`/`RouteChangeProvider`. It owns
  the **socket.io real-time layer**: group create/exit/admin-change, contact add/remove, profile
  picture change, and online/offline presence all arrive as socket events here and get merged into
  Redux state — **this is a live-collaboration app, not just request/response**, so UI tests that only
  check "does a click work" miss an entire class of behavior (does screen A update when screen B's
  action fires a socket event to it).
- A **heartbeat** runs every 10s via a dedicated Web Worker (not `setInterval`) specifically so a
  backgrounded tab doesn't get marked offline by browser timer throttling — worth its own reliability
  test.
- Auth token injection is a **`window.fetch` monkey-patch** (`interceptFetch.js`), not an axios
  interceptor, allow-listing specific API hosts (`devapi2.kpostindia.com`, `kmail5.kpostindia.com`,
  `kmail.kpostindia.com`, a local dev IP, `kpostapis.kpostindia.com`) and explicitly protecting
  Firebase/Google domains from token injection. **Open question:** these hardcoded hosts don't
  literally match the bench's `testingapi.kpostindia.com` / `testkmail.kpostindia.com` — likely this
  list is a superset covering multiple environments (dev/local/prod) and the live test build is
  configured to point at the test hosts via its own build-time env, but this should be **verified**,
  not assumed, before relying on it.

## Module map: Route map (from `MenuRoutes.js` — ground truth, not assumed)

### Public (no auth token required)

| Route                            | Component             | Notes                                                                                   |
| -------------------------------- | --------------------- | --------------------------------------------------------------------------------------- |
| `/`                              | `Home` (auth/Home.js) | Landing                                                                                 |
| `/login`                         | `Login`               |                                                                                         |
| `/signup`                        | `MainSignup`          | `Register.js` exists but is **not routed** — dead code unless reachable another way     |
| `/profile-webview/:id`           | `ProfileWebView`      | Shareable public profile card                                                           |
| `/koolkall/:id`                  | `GlobalKoolKall`      | Public call-join link                                                                   |
| `/kall-window`                   | `KallWindow`          |                                                                                         |
| `/digital-card/:id`              | `GloabalDigitalCard`  | Shareable digital business card                                                         |
| `/child-safety-standards-policy` | `ChildSafetyPolicy`   | Static compliance page — in the public screen sweep since 2026-10-10 (`screens-public`) |
| `*`                              | `NotFound`            | In the sweep as `NotFound` (signed in; anonymous unknown routes bounce to `/login`)     |

Public-route sweep status (2026-10-10): `/login`, `/signup`, `/child-safety-standards-policy`,
`/kall-window` (signed-out "Unauthorized" state) and `/kposter` are in `src/ui/screens.ts` as
`PUBLIC_SCREENS` and swept anonymously with the full check catalogue. `/` redirects to `/login`.
The three parameterised routes keep their own specs because they need a real id.

### Authenticated (wrapped in `<Header>` layout, requires `user.user` truthy)

| Route             | Component        | Bench coverage today                                                                                                                                                                                           |
| ----------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/home`           | `MainHomePage`   | breakage-sweep only                                                                                                                                                                                            |
| `/katchup`        | `Katchup`        | **Deep** — API + UI functional + breakage                                                                                                                                                                      |
| `/kmail`          | `Kmail`          | API deep; UI functional not built                                                                                                                                                                              |
| `/writemail`      | `Kmail` ⚠️       | Routes to `Kmail` with the compose form opened. In the sweep since 2026-10-10 (`screens-batch4`); that day a PERSONAL user hit the error boundary ("Something went wrong") on 2 of 3 loads — the shape of #990 |
| `/kall`           | `Kall`           | API deep; UI functional not built                                                                                                                                                                              |
| `/kdirectory`     | `Kdirectory`     | API (contacts) deep; UI functional partial                                                                                                                                                                     |
| `/kcloud`         | `KCloud`         | **Zero coverage**                                                                                                                                                                                              |
| `/kbooking`       | `KBook`          | **Zero coverage**                                                                                                                                                                                              |
| `/settings`       | `Setting`        | API (generalSetting) partial; UI covers ~4 of 25 real panels                                                                                                                                                   |
| `/knews`          | `Knews`          | **Zero coverage**                                                                                                                                                                                              |
| `/e-commerce`     | `ECommerce`      | **Zero coverage**                                                                                                                                                                                              |
| `/kdoc`           | `KOS`            | API deep (KWord); UI not built                                                                                                                                                                                 |
| `/userprofile`    | `UserProfile`    | API deep; UI functional partial                                                                                                                                                                                |
| `/usermanagement` | `UserManagement` | Three functional/security/a11y specs + the business-session sweep (`screens-business`), BUSINESS_S only — a PERSONAL user gets the shell with no workspace (verified 2026-10-10)                               |
| `/kposter`        | KPoster feed     | Client-side demo, no backend. Swept signed in (`screens-batch4`) and anonymously (`screens-public`)                                                                                                            |

### Other

| Route      | Component              | Notes                                                                                                 |
| ---------- | ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `/profile` | `Profile` (dashboard/) | **Redirects to `/userprofile`** (verified live 2026-10-10) — an alias, not a screen (`ROUTE_ALIASES`) |

⚠️ **`/kdiary` has NO route at all** — commented out in `MenuRoutes.js`. `KDiary.js` exists (1 file) and
the bench already has API tests running against KDiary's backend (`dairyschedule`, 14 endpoints
tested per `docs/generated/coverage.md`), but **the screen is currently unreachable by a real user**. This is
either a genuine defect (a feature the backend supports but the frontend never shipped a route for)
or a deliberate hide-while-incomplete — needs a product-owner answer, not a guess, before deciding
whether to file it as a bug.

## Module map: Module inventory (component file count = rough complexity signal)

| Module                |       Files | Bench status                     | Backend API (docs/generated/coverage.md)                      |
| --------------------- | ----------: | -------------------------------- | ------------------------------------------------------------- |
| Katchup               |         120 | Deep (API+UI+breakage)           | `katchup` 36/36 tested                                        |
| Settings              |          27 | Partial UI (4/25 panels)         | `generalsetting` 7/7 + pieces of `kmail`/`profile`/`contacts` |
| Kmail                 |          25 | API only                         | `kmail` 79/80 tested                                          |
| Kall                  |          21 | API only                         | `kall` 20/20 tested                                           |
| KOS                   |           8 | API only                         | `kword` 14/14 tested                                          |
| Kdirectory (Contacts) |           4 | API + UI functional              | `contacts` 16/16 tested                                       |
| K-Booking             |           3 | **Zero**                         | not in docs/generated/coverage.md — verify a backend exists   |
| KNews                 |           3 | **Zero**                         | not in docs/generated/coverage.md — verify a backend exists   |
| KCloud                |           2 | **Zero**                         | not in docs/generated/coverage.md — verify a backend exists   |
| K-ECommerce           |           2 | **Zero**                         | not in docs/generated/coverage.md — verify a backend exists   |
| UserProfile           | 1 (+nested) | API deep + UI functional partial | `profile` 45/45 tested                                        |
| UserManagement        |           1 | **Zero**                         | check `admin`-module scope                                    |
| KDiary                |           1 | API only, **unrouted**           | `dairyschedule` 14/14 tested                                  |
| WriteMail             |           1 | Dead/unrouted                    | n/a                                                           |
| ChildSafetyPolicy     |           1 | **Zero**                         | static content — likely UI-only                               |

**Settings' 25 real sub-panels** (folders under `src/components/Settings/`), cross-referenced against
current coverage:

| Panel                                                                                                                                                                                                                        | UI coverage                               | Likely backing API                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------- |
| About, BasicInformation, ContactInformation, Education, Experience, OtherActivities                                                                                                                                          | ✅ partial (`profile-functional.spec.ts`) | `profile`                                      |
| Notification, Personalize, InstantReply, MailSignature                                                                                                                                                                       | ✅ (`settings-functional.spec.ts`)        | `generalsetting` / `kmail`'s `kmailSetting`    |
| BlockedContact                                                                                                                                                                                                               | ✅ partial (`contacts-breakage`/API)      | `contacts` block/unblock                       |
| AccountRecovery, BusinessSettings, ChangeMobNumber, ChangePassword, DataStorage, DeleteAccount, DigitalCardSettings, KnewsSettings, LetterHead, OtherMail, SecurityPrivacy, Settingdetails, SettingProfile, VacationResponse | ❌ **no UI test**                         | mostly unmapped — needs per-panel confirmation |

## Module map: Icons

Font-icon system via **icomoon** (`src/Assets/icons/icomoon/fonts/*`), consumed as `.icon-KP_###...`
CSS classes — exactly the selectors already used throughout the bench's UI specs (e.g.
`.icon-KP_107-User-Add`, `.icon-KP_112-Group-Add`). No separate SVG-icon-per-file convention to learn.

## Module map: ⚠️ K-Booking is a REAL payment flow — hard safety boundary

`Services/KBooking.js` is a genuine **redbus.in bus-ticket booking integration**: city search,
trip listing, `BlockTickets`, `GenerateOrderID`, `verifySignature` (a payment-gateway signature
check — Razorpay/PayU-style), `BookTicket`, `CancelTicket`. Base URL is hardcoded to
`https://devapi2.kpostindia.com`. This is money-moving, exactly the class of feature the bench
already refuses to touch for OTP/SMS. **No automated test may call `BookTicket`, `GenerateOrderID`,
`verifySignature`, or the payment-gateway UI endpoints** without explicit written authorization and
a sandboxed payment gateway confirmed by the product owner. Safe to test: city suggestion, trip
search/listing, ticket lookup (read-only). This overrides Phase 2's K-Booking scope in the test plan.

## Module map: Correction: `Services/ECommerce.js` is dead/misnamed, not the real E-Commerce API

Despite its name, `Services/ECommerce.js` contains **KDiary schedule** endpoints
(`CreateDiarySchedule`, `GetAllDiarySchedule`, `DeleteDiaryScheduleEvent`, …) — leftover from a
copy/refactor, not wired to the E-Commerce screen. The real `/e-commerce` route
(`K-ECommerce/ECommerce.js`) renders `ECommerceList` instead, which has not yet been traced to its
actual data source — do that before writing E-Commerce tests; do not assume `Services/ECommerce.js`
is it.
