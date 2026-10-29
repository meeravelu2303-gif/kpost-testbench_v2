import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:kpost5_2023/app_common/views/screens/home_dashboard_screens/home_dashboard_screen.dart';
import 'package:kpost_common/auth/views/widgets/access_code_ui/otp_verification_widget.dart';
import 'package:patrol/patrol.dart';
import 'package:pinput/pinput.dart';

import 'support/bench.dart';
import 'support/first_run.dart';

/// Signup & Login on the phone: the access code. Signed in with the password, the user sets the
/// 4-digit code from Settings → General Settings → Change Access Code (password first, then the code
/// twice); the app then shows the unlock screen, and the code opens Home again. Every run sets the
/// same code (QATEST7_ACCESS_CODE), so the account is left as it was. No OTP anywhere on this path.
void main() {
  patrolTest('a signed-in user sets an access code in Settings and unlocks the app with it',
      config: benchConfig, ($) async {
    await signInWithPassword($);

    await $(find.byIcon(KPOST.KP_20_Menu_Open)).tap();
    await $(Drawer).$('Settings').scrollTo().tap();
    await $(ListTile).containing('General Settings').tap();
    await $('Change Access Code').scrollTo().tap();

    // Password re-entry ("Enter Password" is both the heading and the hint: find the field by type).
    await $(TextField).first.enterText(Bench.password);
    await $(ElevatedButton).containing('Continue').tap();

    // The create screen keeps the Settings title only when it reused the password screen's state.
    await $('Enter Your New Access Code').waitUntilVisible();
    expect($('Change Access Code'), findsWidgets,
        reason: 'the new-code screen still belongs to the Settings flow');
    await $(Pinput).at(0).enterText(Bench.accessCode);
    await $(Pinput).at(1).enterText(Bench.accessCode);
    final submit = $(ElevatedButton).containing('Submit');
    expect($.tester.widget<ElevatedButton>(submit.first).onPressed, isNotNull,
        reason: 'Submit is enabled once both codes match');

    // The confirmation is a 2-second snackbar: tap without waiting for the screen to settle.
    await submit.tap(settlePolicy: SettlePolicy.noSettle);
    await $('Access code is set successfully').waitUntilVisible();

    // The app moves straight to the unlock screen, in access-code mode.
    await $('Login with Password').waitUntilVisible();
    expect($('Enter Your Access Code'), findsWidgets, reason: 'the unlock screen asks for the code');
    await $(OtpVerificationWidget).$(TextField).enterText(Bench.accessCode);

    await waitForHome($);
    await dismissHomePopups($);
    expect($(HomeDashboardScreen), findsOneWidget, reason: 'the access code opens Home');
  });
}
