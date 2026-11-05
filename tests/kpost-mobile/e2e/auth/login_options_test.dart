import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/views/screens/home_dashboard_screens/home_dashboard_screen.dart';
import 'package:patrol/patrol.dart';

import '../../support/bench.dart';
import '../../support/first_run.dart';
import '../../support/peer_api.dart';

/// Signup & Login on the phone, the other ways through the sign-in screen (signin_controller.dart,
/// user_signin_widget.dart, user_auth_widget.dart): the registered mobile number instead of the KPost
/// ID, the domain suggestion after "@", and the password step's own controls (Login off while empty,
/// the eye, Back, Need Help). "Forgot Password" is never tapped: it texts the account's phone at once.
void main() {
  Future<void> openKpostIdStep(PatrolIntegrationTester $) async {
    Bench.requireConfig();
    await startFreshApp($);
    await $('Select your Country').tap();
    await $('India').tap();
  }

  Future<void> openPasswordStep(PatrolIntegrationTester $) async {
    await openKpostIdStep($);
    await $(TextField).first.enterText(Bench.kpostId);
    await $('Submit').tap();
    await $('Login with Other KPOST ID').waitUntilVisible();
  }

  bool loginEnabled(PatrolIntegrationTester $) =>
      $.tester.widget<ElevatedButton>($(ElevatedButton).containing('Login').first).onPressed != null;

  patrolTest('a personal user signs in with the registered mobile number and reaches Home',
      config: benchConfig, ($) async {
    final me = await (await ApiUser.phoneAccountForCleanup()).identity();
    expect(me.mobile, matches(RegExp(r'^\d{10}$')),
        reason: 'the account has a 10-digit mobile number to sign in with');
    await openKpostIdStep($);
    await $(TextField).first.enterText(me.mobile);
    await $('Submit').tap();
    for (var second = 0; second < 15; second++) {
      await $.pump(const Duration(seconds: 1));
      if ($('Login with Other KPOST ID').exists || $('Select a KPOST Channel').exists) break;
    }
    if ($('Select a KPOST Channel').exists) {
      // Several accounts share the number: pick this account's card only when exactly one card
      // carries its first name, so the password is never typed into someone else's account.
      final shown = dumpScreen($, 'channel sheet');
      final cards = find.textContaining(me.firstName);
      expect(cards.evaluate().length, 1,
          reason: 'exactly one channel card names "${me.firstName}"; on screen: $shown');
      await $(cards).tap();
      await $('Login with Other KPOST ID').waitUntilVisible();
    }
    await $(TextField).first.enterText(Bench.password);
    await $(ElevatedButton).$('Login').tap();
    await waitForHome($);
    await dismissHomePopups($);
    expect($(HomeDashboardScreen), findsOneWidget, reason: 'the mobile number signs in to Home');
  });

  patrolTest('typing "@" after the KPost ID suggests the domain, and the suggestion signs in',
      config: benchConfig, ($) async {
    await openKpostIdStep($);
    final local = Bench.kpostId.split('@').first;
    // The suggestions open only for the focused field (TypeAheadField), so it is tapped first.
    await $(TextField).first.tap();
    await $(TextField).first.enterText('$local@');
    await $.pump(const Duration(seconds: 3));
    expect($.tester.widget<TextField>($(TextField).first).controller?.text, '$local@',
        reason: 'the KPost ID was typed');
    final shown = dumpScreen($, 'after @');
    final suggestion = $(RegExp('kpostindia\\.com'));
    expect(suggestion, findsWidgets, reason: 'the @kpostindia.com domain is suggested; on screen: $shown');
    await suggestion.last.tap();
    await $.pump(const Duration(milliseconds: 500));
    expect($.tester.widget<TextField>($(TextField).first).controller?.text, '$local@kpostindia.com',
        reason: 'the suggestion completes the KPost ID');
    await $('Submit').tap();
    await $('Login with Other KPOST ID').waitUntilVisible();
  });

  patrolTest('the password step: Login is off while empty, and the eye shows and hides the password',
      config: benchConfig, ($) async {
    await openPasswordStep($);
    expect(loginEnabled($), isFalse, reason: 'Login is off with no password');
    await $(TextField).first.enterText('Visible1!');
    expect(loginEnabled($), isTrue, reason: 'Login is on once a password is typed');
    bool hidden() => $.tester.widget<TextField>($(TextField).first).obscureText;
    expect(hidden(), isTrue, reason: 'the password is hidden at first');
    await $(find.byIcon(Icons.visibility_off)).tap();
    expect(hidden(), isFalse, reason: 'the eye shows it');
    await $(find.byIcon(Icons.visibility)).tap();
    expect(hidden(), isTrue, reason: 'and hides it again');
  });

  patrolTest('the password step: Need Help offers Forgot Password, and Cancel closes it',
      config: benchConfig, ($) async {
    await openPasswordStep($);
    await $('Need Help?').tap();
    await $.pump(const Duration(seconds: 1));
    final shown = dumpScreen($, 'Need Help sheet');
    expect($('Forgot Password'), findsOneWidget, reason: 'on screen: $shown');
    await $('Cancel').last.tap();
    await $.pump(const Duration(seconds: 1));
    expect($('Forgot Password'), findsNothing, reason: 'Cancel closes the sheet');
    expect($('Login with Other KPOST ID'), findsOneWidget, reason: 'the password step is still open');
  });

  patrolTest('the password step: Login with Other KPOST ID goes back to an empty KPost ID step',
      config: benchConfig, ($) async {
    await openPasswordStep($);
    await $('Login with Other KPOST ID').tap();
    await $('Select your Country').waitUntilVisible();
    expect($('Login with Other KPOST ID'), findsNothing, reason: 'the password step is closed');
  });
}
