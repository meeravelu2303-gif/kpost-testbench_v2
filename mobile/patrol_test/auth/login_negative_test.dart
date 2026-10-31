import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/views/screens/home_dashboard_screens/home_dashboard_screen.dart';
import 'package:patrol/patrol.dart';

import '../support/bench.dart';
import '../support/first_run.dart';

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
    expect($('Enter Password'), findsNothing,
        reason: 'with no KPost ID the password step never opens');
  });

  patrolTest('an unknown KPost ID is refused with "Please Enter Valid KpostID or MobileNumber"',
      config: benchConfig, ($) async {
    await openKpostIdStep($);
    final absent = 'qa.absent.${DateTime.now().millisecondsSinceEpoch}@kpostindia.com';
    await $(TextField).first.enterText(absent);
    await $('Submit').tap(settlePolicy: SettlePolicy.noSettle);
    await $('Please Enter Valid KpostID or MobileNumber').waitUntilVisible();
    expect($('Enter Password'), findsNothing,
        reason: 'an unknown KPost ID never reaches the password step');
  });

  patrolTest('a wrong password is refused with "Invalid Credential", then the right one signs in',
      config: benchConfig, ($) async {
    await openKpostIdStep($);
    await $(TextField).first.enterText(Bench.kpostId);
    await $('Submit').tap();
    await $('Enter Password').waitUntilVisible();

    await $(TextField).first.enterText('${Bench.password}-wrong');
    await $(ElevatedButton).$('Login').tap(settlePolicy: SettlePolicy.noSettle);
    await $('Invalid Credential').waitUntilVisible();
    expect($(HomeDashboardScreen), findsNothing, reason: 'a wrong password does not open Home');

    // The account rule: a wrong password is always followed by a good login.
    await $(TextField).first.enterText(Bench.password);
    await $(ElevatedButton).$('Login').tap();
    await waitForHome($);
    await dismissHomePopups($);
    expect($(HomeDashboardScreen), findsOneWidget, reason: 'the right password still signs in');
  });
}
