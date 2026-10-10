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
the committed file points `EndPointURL`/`KmailEndPointURL` at **LAN IPs** (a dev build), while the
deployed live UI at `account.kpostindia.com` talks to `devapi2`/`kmail5`. UI tests drive the deployed
app and should intercept by **path** (`**/katchup/sendMessage/`), never by origin. Per-file function
lists: `Login.js`, `Katchup.js`, `Kall.js`, `Kmail.js`, `Setting.js` (profile + `/admin/*`),
`Contacts.js`, `KOS.js`, `ECommerce.js`, `ThemeSettings.js` — see the frontend source for the full
per-function table.
