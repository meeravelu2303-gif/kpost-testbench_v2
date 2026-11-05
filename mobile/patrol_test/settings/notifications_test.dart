import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:kpost5_2023/settings/views/screens/general_settings.dart';
import 'package:kpost5_2023/settings/views/widget/do_not_disturb_widget.dart';
import 'package:kpost5_2023/settings/views/widget/notification_widget.dart';
import 'package:patrol/patrol.dart';

import '../support/bench.dart';
import '../support/first_run.dart';
import '../support/peer_api.dart';
import '../support/settings_api.dart';

/// Settings › General Settings › Notifications on the phone (notification_widget.dart: a Katchup, a
/// KMail and a Kall section, each a preview switch, Sound "Default", Vibrate and Do Not Disturb;
/// do_not_disturb_widget.dart: the duration list and "Enable"). Every switch saves at once
/// (settings_controller.dart katchupNotification / kmailNotification / kallNotification ->
/// generalSetting/{katchup,kmail,kall}Notification with NotificationRequestModel: messagePreview,
/// sound, vibrate, doNotDisturb as 0/1). What the phone switched must be what the server keeps
/// (generalSetting/getAllNotification), read as the phone's account after the phone part.
///
/// The app starts every switch from its own stored preferences (a fresh install: previews and
/// Vibrate on, Do Not Disturb off) and never reads the server's values, so each test changes one
/// switch away from that default. The server's original block is read before the phone signs in and
/// written back afterwards whenever it changed.
///
/// Watch on the first run: the backend copy (GeneralSettingServiceImpl, KPA-495) reads the keys
/// "Message Preview" / "Sound" / "Vibrate" / "Do Not Disturb", not the app's camelCase keys, and
/// answers 400 when "Do Not Disturb" is missing; if the QA server matches that copy, nothing the phone
/// switches is kept and these tests fail as the finding (the app shows "Notification settings update
/// failed..").
void main() {
  /// Drawer › Settings › General Settings › Notifications.
  Future<void> openNotifications(PatrolIntegrationTester $) async {
    await signInWithPassword($);
    await $(find.byIcon(KPOST.KP_20_Menu_Open)).tap();
    await tapDrawerItem($, 'Settings');
    if (await $.platform.mobile.isPermissionDialogVisible(timeout: const Duration(seconds: 3))) {
      await $.platform.mobile.grantPermissionWhenInUse();
    }
    await $(ListTile).containing('General Settings').scrollTo().tap();
    await $(GeneralSettings).waitUntilVisible();
    await $(ListTile).containing('Notifications').scrollTo().tap();
    await $(NotificationWidget).waitUntilVisible();
    await $.pump(const Duration(seconds: 1));
  }

  /// The switch on the row labelled [label]; [index] picks among rows that share a label
  /// ("Vibrate" and "Do Not Disturb": 0 Katchup, 1 KMail, 2 Kall).
  PatrolFinder toggle(PatrolIntegrationTester $, String label, {int index = 0}) =>
      $(Row).containing(label).$(Switch).at(index);

  /// Scrolls [target] into view inside the Notifications page's own scroll view.
  Future<PatrolFinder> reveal(PatrolIntegrationTester $, PatrolFinder target) => target.scrollTo(
        view: find
            .descendant(of: find.byType(NotificationWidget), matching: find.byType(Scrollable))
            .first,
      );

  bool isOn(PatrolIntegrationTester $, PatrolFinder target) =>
      $.tester.widget<Switch>(target).value;

  /// Flips [label]'s switch and waits for the save to come back.
  Future<String> flip(PatrolIntegrationTester $, String label, {int index = 0}) async {
    await (await reveal($, toggle($, label, index: index))).tap();
    await $.pump(const Duration(seconds: 3));
    return dumpScreen($, 'after switching $label');
  }

  /// Puts the server's [channel] block back when the test changed it (cleanup; never throws).
  Future<void> restore(String channel, Map<String, dynamic>? original) async {
    try {
      final api = await ApiUser.phoneAccountForCleanup();
      final now = (await api.notifications())[channel];
      if ('$now' == '$original') return;
      final status = await api.restoreNotification(channel, original);
      // ignore: avoid_print
      print('BENCH-CLEANUP $channel notification restored: HTTP $status (was $original)');
    } catch (e) {
      // ignore: avoid_print
      print('BENCH-CLEANUP $channel notification not restored: $e');
    }
  }

  /// Checks the server's [channel] block after the phone switched one setting: [changed] is the
  /// stored key that the phone switched and [expected] its new value; every other flag must still be
  /// what the phone showed (the app sends the whole block on every switch).
  Future<void> expectStored({
    required String channel,
    required String changed,
    required bool expected,
    required Map<String, bool> unchanged,
    required String shown,
  }) async {
    // Signs in as the phone's account, which ends the phone's session: the phone is done.
    final block = (await (await ApiUser.phoneAccountForCleanup()).notifications())[channel];
    const camel = {
      'Message Preview': 'messagePreview',
      'Vibrate': 'vibrate',
      'Do Not Disturb': 'doNotDisturb',
    };
    expect(settingsFlag(block, changed, camel[changed]), expected,
        reason: 'the server keeps $channel "$changed" as switched on the phone '
            '(stored block: $block); on screen: $shown');
    unchanged.forEach((key, value) {
      expect(settingsFlag(block, key, camel[key]), value,
          reason: 'the server keeps $channel "$key" as the phone showed it (stored block: $block)');
    });
  }

  patrolTest('Katchup Message Preview switched off on the phone is kept by the server',
      config: benchConfig, ($) async {
    final original = (await (await ApiUser.phoneAccountForCleanup()).notifications())['katchup'];
    try {
      await openNotifications($);
      expect(isOn($, toggle($, 'Message Preview')), isTrue,
          reason: 'a fresh install starts with Message Preview on (settings_controller.dart)');
      final shown = await flip($, 'Message Preview');
      expect(isOn($, toggle($, 'Message Preview')), isFalse,
          reason: 'the switch shows off after the tap; on screen: $shown');
      await expectStored(
        channel: 'katchup',
        changed: 'Message Preview',
        expected: false,
        unchanged: const {'Vibrate': true, 'Do Not Disturb': false},
        shown: shown,
      );
    } finally {
      await restore('katchup', original);
    }
  });

  patrolTest('KMail Vibrate switched off on the phone is kept by the server', config: benchConfig,
      ($) async {
    final original = (await (await ApiUser.phoneAccountForCleanup()).notifications())['kmail'];
    try {
      await openNotifications($);
      final shown = await flip($, 'Vibrate', index: 1);
      expect(isOn($, toggle($, 'Vibrate', index: 1)), isFalse,
          reason: 'the KMail Vibrate switch shows off after the tap; on screen: $shown');
      expect(isOn($, toggle($, 'Vibrate')), isTrue,
          reason: 'the Katchup Vibrate switch is not touched by the KMail one; on screen: $shown');
      await expectStored(
        channel: 'kmail',
        changed: 'Vibrate',
        expected: false,
        unchanged: const {'Message Preview': true, 'Do Not Disturb': false},
        shown: shown,
      );
    } finally {
      await restore('kmail', original);
    }
  });

  patrolTest('Kall notifications switched off on the phone are kept by the server',
      config: benchConfig, ($) async {
    final original = (await (await ApiUser.phoneAccountForCleanup()).notifications())['kall'];
    try {
      await openNotifications($);
      // The Kall section's first switch, labelled "Kall", is its preview flag (kallMessagePreview).
      final shown = await flip($, 'Kall');
      expect(isOn($, toggle($, 'Kall')), isFalse,
          reason: 'the Kall switch shows off after the tap; on screen: $shown');
      await expectStored(
        channel: 'kall',
        changed: 'Message Preview',
        expected: false,
        unchanged: const {'Vibrate': true, 'Do Not Disturb': false},
        shown: shown,
      );
    } finally {
      await restore('kall', original);
    }
  });

  patrolTest('Katchup Do Not Disturb enabled for 30 minutes on the phone is kept by the server',
      config: benchConfig, ($) async {
    final original = (await (await ApiUser.phoneAccountForCleanup()).notifications())['katchup'];
    try {
      await openNotifications($);
      await (await reveal($, toggle($, 'Do Not Disturb'))).tap();
      await $(DoNotDisturbWidget).waitUntilVisible();
      await $('Enable Do Not Disturb On').waitUntilVisible();
      await $('30 Minutes').tap();
      await $('Enable').tap();
      await $(NotificationWidget).waitUntilVisible();
      await $.pump(const Duration(seconds: 3));
      final shown = dumpScreen($, 'after enabling Do Not Disturb');
      expect(isOn($, toggle($, 'Do Not Disturb')), isTrue,
          reason: 'the Katchup Do Not Disturb switch shows on after Enable; on screen: $shown');
      expect(isOn($, toggle($, 'Do Not Disturb', index: 1)), isFalse,
          reason: "KMail's Do Not Disturb is not switched by Katchup's; on screen: $shown");
      await expectStored(
        channel: 'katchup',
        changed: 'Do Not Disturb',
        expected: true,
        unchanged: const {'Message Preview': true, 'Vibrate': true},
        shown: shown,
      );
    } finally {
      await restore('katchup', original);
    }
  });

  patrolTest('Do Not Disturb is not enabled when its duration screen is left without Enable',
      config: benchConfig, ($) async {
    final original = (await (await ApiUser.phoneAccountForCleanup()).notifications())['katchup'];
    try {
      await openNotifications($);
      await (await reveal($, toggle($, 'Do Not Disturb'))).tap();
      await $(DoNotDisturbWidget).waitUntilVisible();
      await $.platform.android.pressBack();
      await $(NotificationWidget).waitUntilVisible();
      await $.pump(const Duration(seconds: 2));
      final shown = dumpScreen($, 'after leaving Do Not Disturb');
      expect(isOn($, toggle($, 'Do Not Disturb')), isFalse,
          reason: 'leaving the duration screen without Enable keeps Do Not Disturb off; '
              'on screen: $shown');
      final block =
          (await (await ApiUser.phoneAccountForCleanup()).notifications())['katchup'];
      expect('$block', '$original',
          reason: 'nothing is saved to the server when Do Not Disturb is not enabled');
    } finally {
      await restore('katchup', original);
    }
  });
}
