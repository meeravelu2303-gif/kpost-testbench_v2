# Mobile app testing (KPost Flutter app) — decided, not built yet

Decided with the owner on 2026-10-27. Nothing here runs yet; this is the agreed design and the order of work.
The decision-log entry of the same date records why.

## The app

`D:\KPOST_PROJECTS\kpost5_flutter`, branch `Test_ENV` — one Flutter codebase for Android and iOS:

- `kpost/`: the KPost app (1,317 Dart files, 116 screens, GetX). App id `com.kpost.kpost5_flutter`
  (Android), `com.kpost.kpost5Flutter` (iOS). Android 8 (SDK 26) and up.
- `ksmacc/`: the KSMACC app; `kpost_common/`: code both apps share.
- Test hooks are almost absent: 961 tappable widgets, 22 widget keys, 4 `Semantics` labels; many buttons are
  icons with no text. Existing tests: 4 widget tests, no device tests.
- Native parts: permission pop-ups (44 files), file and photo pickers (32), web views (12, KMail bodies),
  push (FCM), incoming calls (CallKit, 7), Agora and Jitsi calls, fingerprint, SMS code autofill, ML Kit,
  maps, speech-to-text, location, 7 share-into-app targets, 4 background services, 23 languages,
  Razorpay (KBooking).

## The tools (all open source, no paid plan)

| Job                                                                                                       | Tool                                                                         | License          |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------- |
| Every screen and flow, Android and iOS                                                                    | **Patrol** (LeanCode, 4.x)                                                   | Apache 2.0       |
| Builds the app                                                                                            | Flutter SDK                                                                  | BSD              |
| Phone control: kill/reopen, install an old version, fingerprint, SMS, camera, slow network, share intents | adb + Android emulator (Xcode `simctl` on the Mac later)                     | Apache 2.0       |
| The second user in calls and chats                                                                        | KPost API calls made from inside the Patrol test                             | ours             |
| Speed and memory                                                                                          | adb (`am start -W`, `dumpsys gfxinfo`, `dumpsys meminfo`) + Flutter DevTools | Apache 2.0 / BSD |
| Accessibility                                                                                             | Flutter's accessibility guidelines (`meetsGuideline`), run inside Patrol     | BSD              |
| Android 8 to 16                                                                                           | One local emulator per version                                               | Apache 2.0       |
| Real phones (optional, later)                                                                             | DeviceFarmer over USB; scrcpy to watch a phone on the PC                     | Apache 2.0       |
| Crashes during a test                                                                                     | adb logcat; Patrol fails the test on any uncaught app error                  | Apache 2.0       |
| App security (storage, settings, the APK)                                                                 | MobSF, latest version, on this PC only (CVE-2026-68927)                      | GPL 3.0          |
| Network security (fake certificate, clear text)                                                           | mitmproxy                                                                    | MIT              |
| Smoke test of the real signed store build                                                                 | Maestro CLI (never Maestro Cloud)                                            | Apache 2.0       |
| Results → bugs                                                                                            | the bench's bug tracker, as product 6 "KPost Mobile"                         | ours / MPL       |

**Emulator image:** Google Play system images (free, not open source; the phone's OS, not a test tool).
Six features need Google Play Services — push, SMS autofill, ML Kit, maps, speech-to-text, location — and
would go untested on a pure open-source image.

**Rejected:** Appium + Flutter driver (needs a test build like Patrol, adds an Appium server, slower and
flakier), Maestro as the main tool (sees only labelled widgets; most KPost icon buttons have none),
`integration_test` alone (stops at the first native pop-up), Espresso/XCUITest (cannot see Flutter widgets),
Detox (React Native only), Firebase Test Lab and BrowserStack (paid), Crashlytics as a test signal (closed).

## What each feature is tested with

| Feature                                                           | Tool                                                                                                                               | Automatic?                                                              |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| All screens and flows, permissions, pickers, web views            | Patrol                                                                                                                             | yes                                                                     |
| Push, incoming calls                                              | Patrol + the second user over the API                                                                                              | Android yes; iPhone needs a real iPhone (simulators get no call pushes) |
| Call connects, mute, end (Agora, Jitsi)                           | Patrol + API                                                                                                                       | yes                                                                     |
| Call sound and picture quality                                    | —                                                                                                                                  | no tool can judge it: short manual check                                |
| Fingerprint, SMS autofill, camera, location                       | emulator commands                                                                                                                  | yes                                                                     |
| Share into KPost, background services, reopen after kill, upgrade | adb, then Patrol                                                                                                                   | yes                                                                     |
| 23 languages                                                      | Patrol with the device language switched (Android; iOS runs in English because Patrol taps iOS permission pop-ups only in English) | yes                                                                     |
| Speed, memory, accessibility                                      | adb, Flutter checks                                                                                                                | yes                                                                     |
| Security                                                          | MobSF, mitmproxy                                                                                                                   | yes                                                                     |
| Store build                                                       | Maestro                                                                                                                            | yes                                                                     |
| Razorpay payments                                                 | Patrol                                                                                                                             | **blocked**: see below                                                  |

## Platforms

- **Android: on this PC.** Physical i7-14700F, 32 GB, virtualization on in firmware. The emulator needs
  Windows Hypervisor Platform (present, disabled; enabling it needs one restart). The emulator shows a phone
  window; every run also records a video for the bug's proof. No phone needed.
- **iOS: later, on a Mac.** Apple builds and runs iOS apps only with Xcode on macOS; macOS in a VM on this PC
  breaks Apple's license. A Mac mini (Apple chip, 16 GB) or a developer's Mac. The same Patrol tests run there.

## Must be fixed by the developers before those tests are written

Found by reading the `Test_ENV` source on 2026-10-27; not yet replayed live, so not bugs yet.

1. **Payments use the live Razorpay key** (`StringConstant.razorpayKeyIdLive` in
   `kbooking_payment_gateway_controller.dart`; there is no test key). A payment test would charge real money.
2. **Live hosts in the test build**, fixed in code, no switch: KMail thumbnails → `kmail5`
   (`string_constant.dart`), the signup captcha → `account.kpostindia.com`, K-AI → `devapi2` (KDoc, excluded
   anyway). Ask for one test/live switch (`--dart-define`).
3. **Security, to verify with mitmproxy before filing:** `badCertificateCallback => true` is set globally
   (`main.dart` `MyHttpOverrides`, every build): the app trusts any HTTPS certificate. Also: no encrypted
   local storage, the login token in plain settings, `usesCleartextTraffic="true"`.

Until 1 and 2 are fixed, mobile tests skip payments, signup and KMail images.

## Rules carried over from the bench

- Test servers only (`testingapi`, `testkmail`); QA accounts only. **Mobile gets its own qatest accounts**:
  one session per account, so a phone login signs out the Playwright runs.
- One wrong-password attempt per account per run; OTP only on the test gateway; one forgot-password SMS per run.
- A finding counts only when it reproduces alone; bugs use the same layout and dedupe as every product.
- The developers' repo is not edited. The bench keeps the Patrol tests and builds a throwaway copy of the
  `Test_ENV` branch with Patrol added (gitignored).
- Runs are by hand, like the other products.

## Order of work

1. Install Flutter, the Android SDK, a Google Play emulator image and the Patrol CLI on this PC; enable
   Windows Hypervisor Platform (one restart).
2. Build the KPost app from `Test_ENV` and open it on the emulator.
3. Patrol tests on the safe flows: login + access code, Katchup send/read, Contacts, Settings.
4. Then: KMail, Group, Kall (second user over the API), KDiary, KBooking (no payment), languages, upgrades.
5. MobSF and mitmproxy; the certificate check first.
6. Product 6 "KPost Mobile" in Bugzilla (owner to name the developer) and the bench's filing.
7. iOS when a Mac is available.
