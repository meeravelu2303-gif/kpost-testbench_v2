import 'dart:async';

import 'package:flutter/material.dart';
import 'package:kpost5_2023/app_common/views/screens/home_dashboard_screens/home_dashboard_screen.dart';
import 'package:kpost5_2023/main.dart' as app;
import 'package:patrol/patrol.dart';

import 'bench.dart';

/// A fresh install, signed in as the phone's account with KPost ID + password, on a clear Home.
/// Every test starts here (Patrol clears the app's data before each one).
Future<void> signInWithPassword(PatrolIntegrationTester $) async {
  Bench.requireConfig();
  // Not awaited: main() waits for the notification permission dialog before it calls runApp.
  unawaited(app.main());
  await allowStartupPermissions($);
  await passIntroToSignIn($);

  // Step A: the KPost ID field stays read-only until a country is chosen.
  await $('Select your Country').tap();
  await $('India').tap();
  await $(TextField).first.enterText(Bench.kpostId);
  await $('Submit').tap();

  // Step B: the same screen swaps in the password field (the app bar also says "Login").
  await $('Enter Password').waitUntilVisible();
  await $(TextField).first.enterText(Bench.password);
  await $(ElevatedButton).$('Login').tap();

  await waitForHome($);
  await dismissHomePopups($);
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

/// Intro slides → Skip; welcome → Login (SignUp would start the sign-up path instead).
Future<void> passIntroToSignIn(PatrolIntegrationTester $) async {
  await $('Skip').tap();
  await $('Login').tap();
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
