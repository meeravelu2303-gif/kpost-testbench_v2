import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:patrol/patrol.dart';

import '../support/bench.dart';
import '../support/first_run.dart';
import '../support/peer_api.dart';

/// Profile › Other Activities on the phone (settings/views/screens/other_activity.dart,
/// settings_controller.dart otheractivitiesInfo): an activity with a title is saved and listed, and an
/// empty one is not. Every activity a test leaves on the account is deleted afterwards.
void main() {
  Future<void> openOtherActivities(PatrolIntegrationTester $) async {
    await signInWithPassword($);
    await $(find.byIcon(KPOST.KP_20_Menu_Open)).tap();
    await tapDrawerItem($, 'Settings');
    await $('Profile Creation').tap();
    await $('Other Activities').tap();
    await $.pump(const Duration(seconds: 2));
  }

  /// Deletes every activity that was not on the account before the test.
  Future<void> removeNew(Set<String> before) async {
    final api = await ApiUser.phoneAccountForCleanup();
    for (final activity in await api.otherActivities()) {
      final id = '${activity['activityID'] ?? ''}';
      if (id.isNotEmpty && !before.contains(id)) await api.deleteOtherActivity(id);
    }
  }

  Future<Set<String>> activityIds() async => {
        for (final a in await (await ApiUser.phoneAccountForCleanup()).otherActivities())
          '${a['activityID'] ?? ''}',
      };

  patrolTest('an activity with a title and achievements is saved and listed', config: benchConfig,
      ($) async {
    final before = await activityIds();
    final title = 'QA activity ${DateTime.now().millisecondsSinceEpoch}';
    try {
      await openOtherActivities($);
      await $(TextField).containing('Enter Activate Title').enterText(title);
      await $(TextField).containing('Enter Course').enterText('QA bench achievement');
      await $('Save').tap();
      await $.pump(const Duration(seconds: 4));
      dumpScreen($, 'after Save');
      final stored = await (await ApiUser.phoneAccountForCleanup()).otherActivities();
      expect(stored.map((a) => a['title']), contains(title),
          reason: 'the server lists the activity saved on the phone; stored: $stored');
    } finally {
      await removeNew(before);
    }
  });

  patrolTest('an activity with no title is not saved', config: benchConfig, ($) async {
    final before = await activityIds();
    try {
      await openOtherActivities($);
      await $('Save').tap();
      await $.pump(const Duration(seconds: 4));
      final shown = dumpScreen($, 'after empty Save');
      final after = await activityIds();
      expect(after.difference(before), isEmpty,
          reason: 'an empty activity must not be stored (the Save button only greys out); '
              'on screen: $shown');
    } finally {
      await removeNew(before);
    }
  });
}
