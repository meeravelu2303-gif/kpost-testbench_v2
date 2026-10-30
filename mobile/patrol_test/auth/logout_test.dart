import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:patrol/patrol.dart';

import '../support/bench.dart';
import '../support/first_run.dart';

/// Logout from the drawer (base_controller.dart: "Confirm Logout" dialog). The app then shows the
/// sign-in screen, or the access-code unlock screen when the account has a code set.
void main() {
  patrolTest('a signed-in user logs out from the drawer after confirming',
      config: benchConfig, ($) async {
    await signInWithPassword($);

    await $(find.byIcon(KPOST.KP_20_Menu_Open)).tap();
    await $(Drawer).$('Logout').scrollTo().tap();

    await $('Confirm Logout').waitUntilVisible();
    expect($('Are you sure you want to log out?'), findsOneWidget,
        reason: 'the user is asked to confirm');
    // The drawer entry and the dialog button share the text: the dialog's is the last one.
    await $('Logout').last.tap();

    var signedOut = false;
    for (var second = 0; second < 30 && !signedOut; second++) {
      await $.pump(const Duration(seconds: 1));
      signedOut = $('Sign in to your account').exists || $('Login with Password').exists;
    }
    expect(signedOut, isTrue,
        reason: 'after logout the app shows the sign-in (or access-code) screen, not Home');
  });
}
