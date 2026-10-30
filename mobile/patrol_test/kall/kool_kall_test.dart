import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:patrol/patrol.dart';

import '../support/bench.dart';
import '../support/first_run.dart';
import '../support/peer_api.dart';

/// Kall › Kool Kall › Create (koolkallView.dart): a one-time meeting today with the second user,
/// using the pickers' own defaults (today; From = now + 10 min, To = From + 40 min). On success the
/// app opens the Android share sheet with the meeting link, closed with Back without sharing. The
/// meeting is ended over the API afterwards.
void main() {
  patrolTest('the user schedules a Kool Kall with another user and it is created',
      config: benchConfig, ($) async {
    // The default slot (now + 10 min, 40 min long) would run past midnight late in the evening.
    if (DateTime.now().hour >= 23) {
      markTestSkipped('the default meeting slot would cross midnight');
      return;
    }
    final title = 'QA kool ${DateTime.now().millisecondsSinceEpoch}';
    var created = <int>[];

    try {
      await signInWithPassword($);

      await $(BottomNavigationBar).$('Kall').tap();
      await $('Kool Kall').tap();
      await $(find.byIcon(KPOST.KP_45_Add)).tap();
      await $('Create Schedule Kall').waitUntilVisible();

      await $(TextFormField).containing('Enter meeting name').enterText(title);
      await $('DD/MM/YYYY').tap();
      await $('OK').tap(); // date picker: today
      await $('From').tap();
      await $('OK').tap(); // time picker: now + 10 min
      await $('To').tap();
      await $('OK').tap(); // time picker: From + 40 min

      await $(' Invite ').tap();
      await $(TextField).containing('Search').enterText('Qatest8');
      await $('Qatest8 Bench').tap();
      await $(find.byIcon(Icons.check)).tap();

      await $('Create Kool Kall').tap();
      await $('Kool Kall created').waitUntilVisible();
      // The share sheet with the meeting link: leave it without sharing.
      await $.pump(const Duration(seconds: 2));
      await $.platform.android.pressBack();

      final peer = await ApiUser.peer();
      final organiser = await ApiUser.phoneAccountForCleanup();
      created = await organiser.todaysKoolKalls(title);
      expect(created, isNotEmpty, reason: "the meeting is in the organiser's Kool Kalls today");
      expect(await peer.todaysKoolKalls(title), isNotEmpty,
          reason: "and in the invited user's Kool Kalls");
    } finally {
      if (created.isNotEmpty) {
        final organiser = await ApiUser.phoneAccountForCleanup();
        for (final id in created) {
          await organiser.endKoolKall(id);
        }
      }
    }
  });
}
