import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:patrol/patrol.dart';

import '../../support/bench.dart';
import '../../support/first_run.dart';
import '../../support/peer_api.dart';

/// Profile › Contact Information on the phone (settings/views/screens/contact_Information.dart,
/// settings_controller.dart updateContactInfo): what the user saves is what the server keeps, the
/// fields stop at their limits, and Second Mobile is optional. The account's contact details are read
/// over the API before the phone signs in and put back at the end.
void main() {
  /// Drawer › Settings › Profile Creation › Contact Information.
  Future<void> openContactInformation(PatrolIntegrationTester $) async {
    await signInWithPassword($);
    await $(find.byIcon(KPOST.KP_20_Menu_Open)).tap();
    await tapDrawerItem($, 'Settings');
    await $('Profile Creation').tap();
    await $('Contact Information').tap();
    await $.pump(const Duration(seconds: 2));
  }

  PatrolFinder field(PatrolIntegrationTester $, String hint) => $(TextField).containing(hint);

  /// Whether the Update button can be pressed.
  bool updateEnabled(PatrolIntegrationTester $) {
    final button = find.ancestor(of: find.text('Update'), matching: find.byType(TextButton));
    return $.tester.widget<TextButton>(button.first).onPressed != null;
  }

  Future<String> typed(PatrolIntegrationTester $, String hint, String text) async {
    await field($, hint).enterText(text);
    await $.pump(const Duration(milliseconds: 500));
    return $.tester.widget<TextField>(field($, hint).first).controller?.text ?? '';
  }

  patrolTest('the address the user saves is the address the server keeps', config: benchConfig,
      ($) async {
    final original = await (await ApiUser.phoneAccountForCleanup()).userProfile();
    final marker = 'QA mobile address ${DateTime.now().millisecondsSinceEpoch}';
    try {
      await openContactInformation($);
      await typed($, 'Enter Your Address', marker);
      await typed($, 'Enter Your City', 'Chennai');
      await typed($, 'Enter Your Area', 'Pazhavanthangal');
      // Update is enabled only with every field filled (see the next test).
      await $(TextField).containing(RegExp(r'^\+91')).enterText('9000000700');
      await $.pump(const Duration(seconds: 1));
      dumpScreen($, 'contact filled');
      expect(updateEnabled($), isTrue, reason: 'Update is enabled with every field filled');
      await $('Update').tap();
      await $.pump(const Duration(seconds: 4));
      dumpScreen($, 'after Update');

      final stored = await (await ApiUser.phoneAccountForCleanup()).userProfile();
      expect('${stored['presentAddress']}', contains(marker),
          reason: 'the server keeps the address typed on the phone '
              '(the app sends it as "presentAddress"; the server stores only addressLine1/2)');
    } finally {
      await (await ApiUser.phoneAccountForCleanup()).setContact(original);
    }
  });

  patrolTest('Pincode takes 6 digits, Second Mobile 10 and Landline 11, digits only',
      config: benchConfig, ($) async {
    await openContactInformation($);
    expect(await typed($, 'Enter Your Pincode', '6000011'), '600001', reason: 'a 7th digit is not taken');
    expect(await typed($, 'Enter Your Pincode', '60a0b0'), '6000', reason: 'letters are dropped');
    final mobile = $(TextField).containing(RegExp(r'^\+91'));
    await mobile.enterText('98765432109');
    await $.pump(const Duration(milliseconds: 500));
    expect($.tester.widget<TextField>(mobile.first).controller?.text, '9876543210',
        reason: 'an 11th Second Mobile digit is not taken');
    expect(await typed($, 'Enter Your Landline Number', '044000000001'), '04400000000',
        reason: 'a 12th Landline digit is not taken');
  });

  patrolTest('Second Mobile is optional: Update works with it empty', config: benchConfig,
      ($) async {
    await openContactInformation($);
    await typed($, 'Enter Your Address', 'QA bench address');
    await typed($, 'Enter Your City', 'Chennai');
    await typed($, 'Enter Your Area', 'Pazhavanthangal');
    await $(TextField).containing(RegExp(r'^\+91')).enterText('');
    await $.pump(const Duration(seconds: 1));
    expect(updateEnabled($), isTrue,
        reason: 'Second Mobile is optional (the server stores null), so Update must not wait for it '
            '(settings_controller.dart contactUpdateButton requires every field)');
  });

  patrolTest('a City longer than the server stores (25) is not taken', config: benchConfig,
      ($) async {
    await openContactInformation($);
    final city = await typed($, 'Enter Your City', 'Q' * 26);
    expect(city.length, lessThanOrEqualTo(25),
        reason: 'City is saved into city varchar(25); a longer one makes the save fail with HTTP 500 '
            '(#13407), so the field must stop at 25');
  });
}
