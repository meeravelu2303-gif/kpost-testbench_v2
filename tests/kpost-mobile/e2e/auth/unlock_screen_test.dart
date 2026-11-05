import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/views/screens/home_dashboard_screens/home_dashboard_screen.dart';
import 'package:kpost_common/auth/views/widgets/access_code_ui/otp_verification_widget.dart';
import 'package:patrol/patrol.dart';
import 'package:pinput/pinput.dart';

import '../../support/bench.dart';
import '../../support/first_run.dart';

/// Signup & Login on the phone, the unlock screen a remembered user sees (user_access_code_widget.dart,
/// signin_password_screen.dart, user_access_code_controller.dart) and Forgot Access Code
/// (forgot_access_code_controller.dart: the password, then a new code; no OTP). Each test sets the
/// access code to QATEST7_ACCESS_CODE from Settings first, as access_code_test does, so the account is
/// left as it was. "Forgot Password" is never tapped: it texts the account's phone at once.
void main() {
  Future<void> openUnlockScreen(PatrolIntegrationTester $) async {
    await signInWithPassword($);
    await setAccessCodeFromSettings($);
  }

  bool loginEnabled(PatrolIntegrationTester $) =>
      $.tester.widget<ElevatedButton>($(ElevatedButton).containing('Login').first).onPressed != null;

  patrolTest('the unlock screen signs in with the password; a wrong one is refused first',
      config: benchConfig, ($) async {
    await openUnlockScreen($);
    await $('Login with Password').tap();
    await $.pump(const Duration(seconds: 1));
    dumpScreen($, 'password mode');
    expect(loginEnabled($), isFalse, reason: 'Login is off with no password');

    // One wrong password, always followed by the right one (the account rule).
    await $(TextField).first.enterText('${Bench.password}-wrong');
    await $(ElevatedButton).containing('Login').tap(settlePolicy: SettlePolicy.noSettle);
    var refused = false;
    for (var i = 0; i < 20 && !refused; i++) {
      await $.pump(const Duration(milliseconds: 250));
      refused = $('In Correct Password').exists;
    }
    expect($(HomeDashboardScreen), findsNothing, reason: 'a wrong password does not unlock the app');

    await $(TextField).first.enterText(Bench.password);
    await $(ElevatedButton).containing('Login').tap();
    await waitForHome($);
    await dismissHomePopups($);
    expect($(HomeDashboardScreen), findsOneWidget, reason: 'the right password opens Home');
    expect(refused, isTrue, reason: 'the wrong password was refused with "In Correct Password"');
  });

  patrolTest('the unlock screen switches from password back to the access code', config: benchConfig,
      ($) async {
    await openUnlockScreen($);
    await $('Login with Password').tap();
    await $(RegExp(r'^\s*Login with Access Code$')).waitUntilVisible();
    await $(RegExp(r'^\s*Login with Access Code$')).tap();
    await $('Enter Your Access Code').waitUntilVisible();
    await $(OtpVerificationWidget).$(TextField).enterText(Bench.accessCode);
    await waitForHome($);
    await dismissHomePopups($);
    expect($(HomeDashboardScreen), findsOneWidget, reason: 'the access code opens Home');
  });

  patrolTest('Forgot Access Code sets a new code after the password, and the code then unlocks the app',
      config: benchConfig, ($) async {
    await openUnlockScreen($);
    await $('Need Help?').tap();
    await $.pump(const Duration(seconds: 1));
    dumpScreen($, 'Need Help sheet');
    expect($('Forgot Password'), findsOneWidget);
    await $('Forgot Access Code').tap();

    await $(TextField).first.waitUntilVisible();
    expect($(ElevatedButton).containing('Continue'), findsOneWidget);
    await $(TextField).first.enterText(Bench.password);
    await $(ElevatedButton).containing('Continue').tap();

    await $('Enter Your New Access Code').waitUntilVisible();
    dumpScreen($, 'new code');
    await $(Pinput).at(0).enterText(Bench.accessCode);
    await $(Pinput).at(1).enterText(Bench.accessCode);
    await $(ElevatedButton).containing('Submit').tap(settlePolicy: SettlePolicy.noSettle);
    var set = false;
    var failed = false;
    for (var i = 0; i < 40 && !set && !failed; i++) {
      await $.pump(const Duration(milliseconds: 250));
      set = $('Access code is set successfully').exists;
      failed = $(RegExp('Something went wrong|^Error')).exists;
    }
    final shown = dumpScreen($, 'after Submit');
    expect(set, isTrue, reason: 'the new code is accepted; on screen: $shown');

    for (var second = 0; second < 15; second++) {
      await $.pump(const Duration(seconds: 1));
      if ($(OtpVerificationWidget).exists || $(HomeDashboardScreen).exists) break;
    }
    if ($(OtpVerificationWidget).exists) {
      await $(OtpVerificationWidget).$(TextField).enterText(Bench.accessCode);
    }
    await waitForHome($);
    await dismissHomePopups($);
    expect($(HomeDashboardScreen), findsOneWidget, reason: 'the new code opens Home');
  });
}
