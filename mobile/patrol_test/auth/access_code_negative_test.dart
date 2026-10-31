import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:kpost5_2023/app_common/views/screens/home_dashboard_screens/home_dashboard_screen.dart';
import 'package:kpost_common/auth/views/widgets/access_code_ui/otp_verification_widget.dart';
import 'package:patrol/patrol.dart';
import 'package:pinput/pinput.dart';

import '../support/bench.dart';
import '../support/first_run.dart';

/// Signup & Login on the phone, the access-code refusals: two different codes cannot be submitted,
/// and a wrong code on the unlock screen is refused with "Pin is incorrect"
/// (user_access_code_widget.dart) while the right one still opens Home. The code is set to
/// QATEST7_ACCESS_CODE as access_code_test does, so the account is left as it was.
void main() {
  patrolTest('mismatched codes cannot be submitted, and a wrong code does not unlock the app',
      config: benchConfig, ($) async {
    await signInWithPassword($);

    await $(find.byIcon(KPOST.KP_20_Menu_Open)).tap();
    await $(Drawer).$('Settings').scrollTo().tap();
    await $(ListTile).containing('General Settings').tap();
    await $('Change Access Code').scrollTo().tap();
    await $(TextField).first.enterText(Bench.password);
    await $(ElevatedButton).containing('Continue').tap();
    await $('Enter Your New Access Code').waitUntilVisible();

    // 1. Two different codes: Submit stays disabled.
    const other = Bench.accessCode == '1357' ? '2468' : '1357';
    await $(Pinput).at(0).enterText(Bench.accessCode);
    await $(Pinput).at(1).enterText(other);
    final submit = $(ElevatedButton).containing('Submit');
    expect($.tester.widget<ElevatedButton>(submit.first).onPressed, isNull,
        reason: 'two different codes cannot be submitted');

    // The matching code, as access_code_test sets it.
    await $(Pinput).at(1).enterText(Bench.accessCode);
    await submit.tap(settlePolicy: SettlePolicy.noSettle);
    await $('Access code is set successfully').waitUntilVisible();
    await $('Login with Password').waitUntilVisible();

    // 2. A wrong code on the unlock screen is refused and Home stays closed.
    await $(OtpVerificationWidget).$(TextField).enterText(other);
    await $('Pin is incorrect').waitUntilVisible();
    expect($(HomeDashboardScreen), findsNothing, reason: 'a wrong code does not unlock the app');

    // 3. The right code still opens Home.
    await $(OtpVerificationWidget).$(TextField).enterText(Bench.accessCode);
    await waitForHome($);
    await dismissHomePopups($);
    expect($(HomeDashboardScreen), findsOneWidget, reason: 'the right code opens Home');
  });
}
