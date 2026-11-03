import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:kpost5_2023/settings/controller/settings_controller.dart';
import 'package:patrol/patrol.dart';

import '../support/bench.dart';
import '../support/first_run.dart';
import '../support/peer_api.dart';

/// Profile › Basic Information on the phone (settings/views/screens/Basic_information.dart,
/// settings_controller.dart updateBasicInfo): a valid Other Email is saved, an invalid one is not, the
/// date of birth cannot be set under 18, and the user is told why a save failed. The account's values
/// are read over the API before the phone signs in and put back at the end.
void main() {
  Future<void> openBasicInformation(PatrolIntegrationTester $) async {
    await signInWithPassword($);
    await $(find.byIcon(KPOST.KP_20_Menu_Open)).tap();
    await tapDrawerItem($, 'Settings');
    await $('Profile Creation').tap();
    await $('Basic Information').tap();
    await $.pump(const Duration(seconds: 2));
  }

  /// The screen's TextField bound to [controller] (the app's own SettingsController field).
  PatrolFinder fieldFor(PatrolIntegrationTester $, TextEditingController controller) => $(
        find.byWidgetPredicate((w) => w is TextField && w.controller == controller),
      );

  SettingsController settings() => Get.find<SettingsController>();

  /// Taps Update and waits for the app's answer (a message on screen) for up to 10 s.
  Future<String> update(PatrolIntegrationTester $) async {
    await $('Update').tap();
    for (var second = 0; second < 10; second++) {
      await $.pump(const Duration(seconds: 1));
      if ($(RegExp('Basic Info')).exists || $(RegExp('18')).exists) break;
    }
    return dumpScreen($, 'after Update');
  }

  patrolTest('a valid Other Email ID is saved and the server keeps it', config: benchConfig,
      ($) async {
    final original = await (await ApiUser.phoneAccountForCleanup()).profile();
    final marker = 'qa.bench.${DateTime.now().millisecondsSinceEpoch}@kpostindia.com';
    try {
      await openBasicInformation($);
      await fieldFor($, settings().otherEmailID).enterText(marker);
      await update($);
      expect($('Profile Creation'), findsWidgets, reason: 'a saved Basic Information returns to Profile Creation');
      final stored = await (await ApiUser.phoneAccountForCleanup()).profile();
      expect((stored['userProfile'] as Map?)?['otherEmail'], marker,
          reason: 'the server keeps the Other Email ID typed on the phone');
    } finally {
      await (await ApiUser.phoneAccountForCleanup()).setBasic(original);
    }
  });

  patrolTest('an invalid Other Email ID is refused and not saved', config: benchConfig, ($) async {
    final original = await (await ApiUser.phoneAccountForCleanup()).profile();
    try {
      await openBasicInformation($);
      await fieldFor($, settings().otherEmailID).enterText('not-an-email');
      final shown = await update($);
      final stored = await (await ApiUser.phoneAccountForCleanup()).profile();
      expect((stored['userProfile'] as Map?)?['otherEmail'], isNot('not-an-email'),
          reason: '"not-an-email" must not be saved as the Other Email ID (no check on the phone or '
              'the server); on screen: $shown');
    } finally {
      await (await ApiUser.phoneAccountForCleanup()).setBasic(original);
    }
  });

  patrolTest('the date picker cannot set a date of birth under 18', config: benchConfig, ($) async {
    await openBasicInformation($);
    await fieldFor($, settings().dateOfBirth).$(IconButton).tap();
    await $.pump(const Duration(seconds: 2));
    dumpScreen($, 'date picker');
    await $('OK').tap();
    await $.pump(const Duration(seconds: 1));
    final picked = DateTime.tryParse(settings().dateOfBirth.text);
    final now = DateTime.now();
    final eighteenYearsAgo = DateTime(now.year - 18, now.month, now.day);
    expect(picked, isNotNull, reason: 'the picker writes a date (${settings().dateOfBirth.text})');
    expect(!picked!.isAfter(eighteenYearsAgo), isTrue,
        reason: 'the picker opens on (and accepts) $picked, which is under 18 (18 years ago is '
            '$eighteenYearsAgo): it starts 18 x 365 days back and its last date is today '
            '(settings_controller.dart selectdate)');
  });

  patrolTest('an under-18 date of birth is refused', config: benchConfig,
      ($) async {
    final original = await (await ApiUser.phoneAccountForCleanup()).profile();
    try {
      await openBasicInformation($);
      final now = DateTime.now();
      final underEighteen = DateTime(now.year - 10, 1, 1).toIso8601String().substring(0, 10);
      settings().dateOfBirth.text = underEighteen;
      await $.pump(const Duration(milliseconds: 500));
      await update($);
      final stored = await (await ApiUser.phoneAccountForCleanup()).profile();
      // The app then shows only the generic native toast "Basic Info failed.." (settings_controller.dart
      // updateBasicInfo), not the server's reason; that toast is outside Flutter, so only the save is checked.
      expect(stored['dateOfBirth'], isNot(underEighteen), reason: 'an under-18 date is not saved');
    } finally {
      await (await ApiUser.phoneAccountForCleanup()).setBasic(original);
    }
  });

  patrolTest('two Known Languages are saved as two languages', config: benchConfig, ($) async {
    final original = await (await ApiUser.phoneAccountForCleanup()).profile();
    try {
      await openBasicInformation($);
      // The field shows the chosen languages ("English" on this account), or its hint when none.
      await ($('Select Known Languages').exists ? $('Select Known Languages') : $('English')).tap();
      await $.pump(const Duration(seconds: 2));
      await $('Hindi').last.tap();
      await $('Apply').tap();
      await $.pump(const Duration(seconds: 1));
      dumpScreen($, 'languages chosen');
      await update($);
      final stored = await (await ApiUser.phoneAccountForCleanup()).profile();
      final languages = ((stored['userProfile'] as Map?)?['knownLanguages'] as List?)?.cast<Object?>();
      expect(languages, containsAll(<String>['English', 'Hindi']),
          reason: 'English and Hindi are stored as two languages, not as one "English,Hindi" '
              '(settings_controller.dart updateBasicInfo sends [knownlanguages.join(",")]); stored: $languages');
    } finally {
      await (await ApiUser.phoneAccountForCleanup()).setBasic(original);
    }
  });
}
