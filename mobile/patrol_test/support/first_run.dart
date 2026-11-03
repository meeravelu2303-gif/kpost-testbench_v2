import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:kpost5_2023/app_common/views/screens/home_dashboard_screens/home_dashboard_screen.dart';
import 'package:kpost5_2023/main.dart' as app;
import 'package:patrol/patrol.dart';
import 'package:pinput/pinput.dart';

import 'bench.dart';

/// A fresh install, signed in as the phone's account with KPost ID + password, on a clear Home.
/// Every test starts here (Patrol clears the app's data before each one).
Future<void> signInWithPassword(PatrolIntegrationTester $) async {
  Bench.requireConfig();
  await startFreshApp($);
  await signInFromSignInScreen($);
}

/// From the sign-in screen (country not chosen yet): KPost ID, password, Home.
Future<void> signInFromSignInScreen(PatrolIntegrationTester $) async {
  // Step A: the KPost ID field stays read-only until a country is chosen.
  await $('Select your Country').tap();
  await $('India').tap();
  await $(TextField).first.enterText(Bench.kpostId);
  await $('Submit').tap();

  // Step B: the same screen swaps in the password field (the app bar also says "Login").
  // "Enter Password" is only the field's hint, which a text finder does not see; this link is
  // real text on the password step (user_auth_widget.dart).
  await $('Login with Other KPOST ID').waitUntilVisible();
  await $(TextField).first.enterText(Bench.password);
  await $(ElevatedButton).$('Login').tap();

  await waitForHome($);
  await dismissHomePopups($);
}

/// A fresh install started and taken to the sign-in screen (country not chosen yet).
Future<void> startFreshApp(PatrolIntegrationTester $) async {
  // main.dart (~746) hands Flutter errors to Crashlytics; with that handler in place an app error only
  // shows up as an opaque "_pendingExceptionDetails != null" assertion. The test binding's handler is
  // put back once main() has run, so a failing test names the app's real error and its stack.
  final testHandler = FlutterError.onError;
  // Not awaited: main() waits for the notification permission dialog before it calls runApp.
  unawaited(app.main());
  await allowStartupPermissions($);
  FlutterError.onError = (details) {
    // An image the server refuses (a profile photo loaded without a token answers 401) is logged for
    // review, not failed: it is a separate finding, and it would fail every test that shows an avatar.
    final text = details.exceptionAsString();
    if (details.library == 'image resource service' && text.contains('Invalid statusCode')) {
      // ignore: avoid_print
      print('BENCH-APP-IMAGE-ERROR: ${text.replaceAll('\n', ' ')}');
      return;
    }
    testHandler?.call(details);
  };
  await passIntroToSignIn($);
}

/// What a fresh install shows before and after sign-in, handled the same way in every test.
/// Mapped from the Test_ENV source (main.dart, splash_controller.dart, home_dashboard_controller.dart).

/// main() asks for notifications before runApp, and the splash asks for location, photos and phone:
/// allow each dialog while one is showing.
Future<void> allowStartupPermissions(PatrolIntegrationTester $) async {
  for (var i = 0; i < 6; i++) {
    final shown = await $.platform.mobile.isPermissionDialogVisible(
      timeout: const Duration(seconds: 4),
    );
    if (!shown) return;
    await $.platform.mobile.grantPermissionWhenInUse();
  }
}

/// Intro slides → Skip; welcome → Login (SignUp would start the sign-up path instead). The intro shows
/// only on the very first launch: a phone where the app's data survived (realme keeps it between
/// runs) opens straight on the welcome screen, so Skip is tapped only if it appears first.
///
/// The splash's permission requests can arrive late (seen 2026-10-31: location came after the
/// startup window, over the welcome screen), so a dialog is allowed whenever one shows meanwhile.
Future<void> passIntroToSignIn(PatrolIntegrationTester $) async {
  for (var second = 0; second < 30; second++) {
    if (await $.platform.mobile.isPermissionDialogVisible(
      timeout: const Duration(milliseconds: 500),
    )) {
      await $.platform.mobile.grantPermissionWhenInUse();
      continue;
    }
    // The phone keeps the app's data between tests, so a later test can open on the remembered
    // user's unlock screen (access code or password, e.g. after access_code_test): start over from
    // the KPost ID step as a fresh install would.
    if ($('Login with Other KPOST ID').exists) {
      await $('Login with Other KPOST ID').tap();
      await allowStartupPermissions($);
      return;
    }
    if ($('Skip').exists) {
      await $('Skip').tap();
      break;
    }
    if ($('Login').exists) break;
    await $.pump(const Duration(seconds: 1));
  }
  await $('Login').tap();
  await allowStartupPermissions($);
}

/// After sign-in: the showcase tour, "Add Your Profession" and "Set as Primary Device" queue up in no
/// fixed order, and a contacts dialog may follow. Dismissed until Home is clear.
///
/// "Set as Primary Device" is always answered No: Yes sends a device OTP, which texts the account's
/// mobile number for real (it ignores the test OTP bypass).
Future<void> dismissHomePopups(PatrolIntegrationTester $) async {
  var quietRounds = 0;
  for (var i = 0; i < 12 && quietRounds < 2; i++) {
    await $.pump(const Duration(seconds: 1));
    if ($('Set as Primary Device').exists) {
      await $('No').tap();
    } else if ($('Skip').exists) {
      await $('Skip').tap(); // the showcase tour, then the profession sheet
    } else if (await $.platform.mobile.isPermissionDialogVisible()) {
      await $.platform.mobile.denyPermission(); // contacts: not needed to reach Home
    } else {
      quietRounds++;
      continue;
    }
    quietRounds = 0;
  }
}

/// Taps a drawer entry (the drawer must be open), scrolling the drawer's own list to it. A bare
/// scrollTo() scrolls the first list on screen, which is Home's Recents behind the drawer, so an
/// entry further down (Logout) was never reached (seen 2026-10-31).
Future<void> tapDrawerItem(PatrolIntegrationTester $, String label) async {
  final drawerList = find
      .descendant(of: find.byType(Drawer), matching: find.byType(Scrollable))
      .first;
  await $(Drawer).$(label).scrollTo(view: drawerList).tap();
}

/// Signed in on Home: sets the access code to [Bench.accessCode] from Settings › General Settings ›
/// Change Access Code (the account keeps the same code every run) and waits for the unlock screen the
/// app then shows, in access-code mode.
Future<void> setAccessCodeFromSettings(PatrolIntegrationTester $) async {
  await $(find.byIcon(KPOST.KP_20_Menu_Open)).tap();
  await tapDrawerItem($, 'Settings');
  await $(ListTile).containing('General Settings').tap();
  await $('Change Access Code').scrollTo().tap();
  await $(TextField).first.enterText(Bench.password);
  await $(ElevatedButton).containing('Continue').tap();
  await $('Enter Your New Access Code').waitUntilVisible();
  await $(Pinput).at(0).enterText(Bench.accessCode);
  await $(Pinput).at(1).enterText(Bench.accessCode);
  await $(ElevatedButton).containing('Submit').tap(settlePolicy: SettlePolicy.noSettle);
  await $('Login with Password').waitUntilVisible();
}

/// Android 14+ may open the full-screen-intent Settings page over the app right after sign-in; Back
/// returns to the app. Only pressed when Home has not appeared on its own.
Future<void> waitForHome(PatrolIntegrationTester $) async {
  try {
    await $(HomeDashboardScreen).waitUntilExists(timeout: const Duration(seconds: 30));
  } on WaitUntilExistsTimeoutException {
    await $.platform.android.pressBack();
    await $(HomeDashboardScreen).waitUntilExists(timeout: const Duration(seconds: 30));
  }
}

/// Prints every non-empty text on screen with a `BENCH-SCREEN <label>:` prefix (read from the phone's
/// log), and returns them: the evidence a failing step quotes, and how a new flow is mapped.
String dumpScreen(PatrolIntegrationTester $, String label) {
  final shown = find
      .byType(Text)
      .evaluate()
      .map((e) => (e.widget as Text).data)
      .whereType<String>()
      .where((t) => t.trim().isNotEmpty)
      .join(' | ');
  // ignore: avoid_print
  print('BENCH-SCREEN $label: $shown');
  return shown;
}
