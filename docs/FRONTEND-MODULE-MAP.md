# KPost frontend module map

**Source analyzed:** `D:\KPOST_PROJECTS\KPOST_REACTJS_2023_V1` (React 18 + Redux + React Router v6 +
Bootstrap 5 + Axios + socket.io-client). 749 source files under `src/`. Hand-built from reading
`App.js`, `MenuRoutes.js`, `src/Services/*`, `src/interceptFetch.js`, and every module folder —
not generated, so it can be wrong; treat it as a starting map to correct as testing finds reality
disagreeing with it.

## How the app boots and stays live

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

## Route map (from `MenuRoutes.js` — ground truth, not assumed)

### Public (no auth token required)
| Route | Component | Notes |
|---|---|---|
| `/` | `Home` (auth/Home.js) | Landing |
| `/login` | `Login` | |
| `/signup` | `MainSignup` | `Register.js` exists but is **not routed** — dead code unless reachable another way |
| `/profile-webview/:id` | `ProfileWebView` | Shareable public profile card |
| `/koolkall/:id` | `GlobalKoolKall` | Public call-join link |
| `/kall-window` | `KallWindow` | |
| `/digital-card/:id` | `GloabalDigitalCard` | Shareable digital business card |
| `/child-safety-standards-policy` | `ChildSafetyPolicy` | Static compliance page — **zero test coverage today** |
| `*` | `NotFound` | |

### Authenticated (wrapped in `<Header>` layout, requires `user.user` truthy)
| Route | Component | Bench coverage today |
|---|---|---|
| `/home` | `MainHomePage` | breakage-sweep only |
| `/katchup` | `Katchup` | **Deep** — API + UI functional + breakage |
| `/kmail` | `Kmail` | API deep; UI functional not built |
| `/writemail` | `Kmail` ⚠️ | **Anomaly:** routes to `Kmail`, not `WriteMail` — `WriteMail.js` (1 file) looks unrouted/dead |
| `/kall` | `Kall` | API deep; UI functional not built |
| `/kdirectory` | `Kdirectory` | API (contacts) deep; UI functional partial |
| `/kcloud` | `KCloud` | **Zero coverage** |
| `/kbooking` | `KBook` | **Zero coverage** |
| `/settings` | `Setting` | API (generalSetting) partial; UI covers ~4 of 25 real panels |
| `/knews` | `Knews` | **Zero coverage** |
| `/e-commerce` | `ECommerce` | **Zero coverage** |
| `/kdoc` | `KOS` | API deep (KWord); UI not built |
| `/userprofile` | `UserProfile` | API deep; UI functional partial |
| `/usermanagement` | `UserManagement` | **Zero coverage** |

### Other
| Route | Component | Notes |
|---|---|---|
| `/profile` | `Profile` (dashboard/) | Distinct from `/userprofile` — different component, purpose unclear yet |

⚠️ **`/kdiary` has NO route at all** — commented out in `MenuRoutes.js`. `KDiary.js` exists (1 file) and
the bench already has API tests running against KDiary's backend (`dairyschedule`, 14 endpoints
tested per `docs/COVERAGE.md`), but **the screen is currently unreachable by a real user**. This is
either a genuine defect (a feature the backend supports but the frontend never shipped a route for)
or a deliberate hide-while-incomplete — needs a product-owner answer, not a guess, before deciding
whether to file it as a bug.

## Module inventory (component file count = rough complexity signal)

| Module | Files | Bench status | Backend API (docs/COVERAGE.md) |
|---|---:|---|---|
| Katchup | 120 | Deep (API+UI+breakage) | `katchup` 36/36 tested |
| Settings | 27 | Partial UI (4/25 panels) | `generalsetting` 7/7 + pieces of `kmail`/`profile`/`contacts` |
| Kmail | 25 | API only | `kmail` 79/80 tested |
| Kall | 21 | API only | `kall` 20/20 tested |
| KOS | 8 | API only | `kword` 14/14 tested |
| Kdirectory (Contacts) | 4 | API + UI functional | `contacts` 16/16 tested |
| K-Booking | 3 | **Zero** | not in COVERAGE.md — verify a backend exists |
| KNews | 3 | **Zero** | not in COVERAGE.md — verify a backend exists |
| KCloud | 2 | **Zero** | not in COVERAGE.md — verify a backend exists |
| K-ECommerce | 2 | **Zero** | not in COVERAGE.md — verify a backend exists |
| UserProfile | 1 (+nested) | API deep + UI functional partial | `profile` 45/45 tested |
| UserManagement | 1 | **Zero** | check `admin`-module scope |
| KDiary | 1 | API only, **unrouted** | `dairyschedule` 14/14 tested |
| WriteMail | 1 | Dead/unrouted | n/a |
| ChildSafetyPolicy | 1 | **Zero** | static content — likely UI-only |

**Settings' 25 real sub-panels** (folders under `src/components/Settings/`), cross-referenced against
current coverage:

| Panel | UI coverage | Likely backing API |
|---|---|---|
| About, BasicInformation, ContactInformation, Education, Experience, OtherActivities | ✅ partial (`profile-functional.spec.ts`) | `profile` |
| Notification, Personalize, InstantReply, MailSignature | ✅ (`settings-functional.spec.ts`) | `generalsetting` / `kmail`'s `kmailSetting` |
| BlockedContact | ✅ partial (`contacts-breakage`/API) | `contacts` block/unblock |
| AccountRecovery, BusinessSettings, ChangeMobNumber, ChangePassword, DataStorage, DeleteAccount, DigitalCardSettings, KnewsSettings, LetterHead, OtherMail, SecurityPrivacy, Settingdetails, SettingProfile, VacationResponse | ❌ **no UI test** | mostly unmapped — needs per-panel confirmation |

## Icons

Font-icon system via **icomoon** (`src/Assets/icons/icomoon/fonts/*`), consumed as `.icon-KP_###...`
CSS classes — exactly the selectors already used throughout the bench's UI specs (e.g.
`.icon-KP_107-User-Add`, `.icon-KP_112-Group-Add`). No separate SVG-icon-per-file convention to learn.

## What "complete UI documentation" would still need (not done here — scoping honestly)

This map is a **structural** pass (routes, modules, rough size, known API pairing) built to plan test
work, not an exhaustive one. It does **not** yet enumerate: every button/action per screen, every
client-side validation rule, every role/permission branch, or a full component-by-component icon
catalogue. That level of detail is better produced **incrementally, per module**, as each module's
test suite is built — reading 120 Katchup files up front, most of which won't be exercised for months,
is not a good use of time. The phased plan in `FRONTEND-TEST-PLAN.md` reflects that: each module's
"analyze" step happens immediately before that module's "implement" step, not all up front.
