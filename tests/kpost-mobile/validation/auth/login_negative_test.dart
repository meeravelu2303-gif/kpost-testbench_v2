import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/views/screens/home_dashboard_screens/home_dashboard_screen.dart';
import 'package:patrol/patrol.dart';

import '../../support/bench.dart';
import '../../support/first_run.dart';

/// Signup & Login on the phone, the refusals (signin_controller.dart, en_US.dart): an empty KPost ID,
/// an unknown KPost ID and a wrong password are each refused with the app's own message, and the
/// right password still signs in afterwards. One wrong password per run, always followed by the
/// good one (the bench's account rule). The messages are in-app snackbars, so Patrol reads them.
void main() {
  /// Fresh install → country chosen → the KPost ID step, nothing typed yet.
  Future<void> openKpostIdStep(PatrolIntegrationTester $) async {
    Bench.requireConfig();
    await startFreshApp($);
    await $('Select your Country').tap();
    await $('India').tap();
  }

  patrolTest('an empty KPost ID is not submitted', config: benchConfig, ($) async {
    await openKpostIdStep($);
    final submit = $(ElevatedButton).containing('Submit');
    final enabled = $.tester.widget<ElevatedButton>(submit.first).onPressed != null;
    if (enabled) {
      await submit.tap(settlePolicy: SettlePolicy.noSettle);
      await $('Enter KpostID or Mobile Number').waitUntilVisible();
    }
    expect($('Login with Other KPOST ID'), findsNothing,
        reason: 'with no KPost ID the password step never opens');
  });

  patrolTest('an unknown KPost ID is refused with "Please Enter Valid KpostID or MobileNumber"',
      config: benchConfig, ($) async {
    await openKpostIdStep($);
    final absent = 'qa.absent.${DateTime.now().millisecondsSinceEpoch}@kpostindia.com';
    await $(TextField).first.enterText(absent);
    await $('Submit').tap(settlePolicy: SettlePolicy.noSettle);
    await $('Please Enter Valid KpostID or MobileNumber').waitUntilVisible();
    // What the screen shows, so a failure says why (the texts go into the reason).
    final shown = find
        .byType(Text)
        .evaluate()
        .map((e) => (e.widget as Text).data)
        .whereType<String>()
        .where((t) => t.trim().isNotEmpty)
        .join(' | ');
    expect($('Login with Other KPOST ID'), findsNothing,
        reason: 'an unknown KPost ID never reaches the password step; on screen: $shown');
  });

  patrolTest('a wrong password is refused with "Invalid Credential", then the right one signs in',
      config: benchConfig, ($) async {
    await openKpostIdStep($);
    await $(TextField).first.enterText(Bench.kpostId);
    await $('Submit').tap();
    await $('Login with Other KPOST ID').waitUntilVisible();

    await $(TextField).first.enterText('${Bench.password}-wrong');
    await $(ElevatedButton).$('Login').tap(settlePolicy: SettlePolicy.noSettle);

    // The right answer is "Invalid Credential" on the password step. The app instead shows a
    // "session expired" alert for the server's 401 (#13379): waited for side by side, so the test
    // reports that instead of waiting forever for the message.
    var refusedRightly = false;
    var expiredAlert = false;
    for (var second = 0; second < 20 && !refusedRightly && !expiredAlert; second++) {
      await $.pump(const Duration(seconds: 1));
      refusedRightly = $('Invalid Credential').exists;
      expiredAlert = $('Your session has expired. Please login again.').exists;
    }
    // Keep watching briefly: the other one can follow the first by a moment.
    for (var second = 0; second < 4; second++) {
      await $.pump(const Duration(seconds: 1));
      refusedRightly = refusedRightly || $('Invalid Credential').exists;
      expiredAlert = expiredAlert || $('Your session has expired. Please login again.').exists;
    }
    expect($(HomeDashboardScreen), findsNothing, reason: 'a wrong password does not open Home');

    // The account rule: a wrong password is always followed by a good login.
    if (expiredAlert) {
      // The alert's button text is padded ('   Logout   ', app_utils.dart showAlert).
      await $(RegExp(r'^\s*Logout\s*$')).last.tap();
      // Logout lands on the sign-in screen, or on the remembered user's screen: start over.
      for (var second = 0; second < 15; second++) {
        await $.pump(const Duration(seconds: 1));
        if ($('Select your Country').exists) break;
        if ($('Login with Other KPOST ID').exists) {
          await $('Login with Other KPOST ID').tap();
          break;
        }
      }
      await signInFromSignInScreen($);
    } else {
      await $(TextField).first.enterText(Bench.password);
      await $(ElevatedButton).$('Login').tap();
      await waitForHome($);
      await dismissHomePopups($);
    }
    expect($(HomeDashboardScreen), findsOneWidget, reason: 'the right password still signs in');
    expect(refusedRightly, isTrue, reason: 'a wrong password must say "Invalid Credential"');
    // Both can show at once (2026-11-02: "Invalid Credential" plus the expired alert, which forces a
    // logout), so the alert is checked on its own.
    expect(expiredAlert, isFalse,
        reason: 'a wrong password must not also show "Your session has expired" and log out (#13379)');
  });
}
