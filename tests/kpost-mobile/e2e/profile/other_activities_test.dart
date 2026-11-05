import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:patrol/patrol.dart';

import '../../support/bench.dart';
import '../../support/first_run.dart';
import '../../support/peer_api.dart';

/// Profile › Other Activities on the phone (settings/views/screens/other_activity.dart,
/// settings_controller.dart otheractivitiesInfo): an activity with a title is saved and kept by the
/// server, an empty one is not, and the form is empty when opened again. The app has no list, edit or
/// delete for activities, so every activity a test leaves on the account is deleted over the API.
void main() {
  Future<void> openOtherActivities(PatrolIntegrationTester $) async {
    await signInWithPassword($);
    await $(find.byIcon(KPOST.KP_20_Menu_Open)).tap();
    await tapDrawerItem($, 'Settings');
    await $('Profile Creation').tap();
    await $('Other Activities').tap();
    await $.pump(const Duration(seconds: 2));
  }

  PatrolFinder titleField(PatrolIntegrationTester $) => $(TextField).containing('Enter Activate Title');
  PatrolFinder achievementsField(PatrolIntegrationTester $) => $(TextField).containing('Enter Course');

  String textOf(PatrolIntegrationTester $, PatrolFinder field) =>
      $.tester.widget<TextField>(field.first).controller?.text ?? '';

  /// Taps Save and waits up to 10 s for the screen to leave (it goes back only on HTTP 200).
  Future<String> save(PatrolIntegrationTester $) async {
    await $('Save').tap();
    for (var second = 0; second < 10; second++) {
      await $.pump(const Duration(seconds: 1));
      if (!titleField($).exists) break;
    }
    return dumpScreen($, 'after Save');
  }

  Future<Set<String>> activityIds() async => {
        for (final a in await (await ApiUser.phoneAccountForCleanup()).otherActivities())
          '${a['activityID'] ?? ''}',
      };

  /// Deletes every activity that was not on the account before the test.
  Future<void> removeNew(Set<String> before) async {
    final api = await ApiUser.phoneAccountForCleanup();
    for (final activity in await api.otherActivities()) {
      final id = '${activity['activityID'] ?? ''}';
      if (id.isNotEmpty && !before.contains(id)) await api.deleteOtherActivity(id);
    }
  }

  patrolTest('an activity with a title and achievements is saved and kept by the server',
      config: benchConfig, ($) async {
    final before = await activityIds();
    final title = 'QA activity ${DateTime.now().millisecondsSinceEpoch}';
    try {
      await openOtherActivities($);
      await titleField($).enterText(title);
      await achievementsField($).enterText('QA bench achievement');
      final shown = await save($);
      expect($('Profile Creation'), findsWidgets,
          reason: 'a saved activity returns to Profile Creation; on screen: $shown');
      final stored = await (await ApiUser.phoneAccountForCleanup()).otherActivities();
      final row = stored.where((a) => a['title'] == title);
      expect(row, hasLength(1), reason: 'the server keeps the activity once; stored: $stored');
      expect(row.first['achievements'], 'QA bench achievement',
          reason: 'with the achievements typed on the phone');
    } finally {
      await removeNew(before);
    }
  });

  patrolTest('an activity with no title is not saved', config: benchConfig, ($) async {
    final before = await activityIds();
    try {
      await openOtherActivities($);
      await titleField($).enterText('');
      await achievementsField($).enterText('');
      final shown = await save($);
      final added = (await activityIds()).difference(before);
      expect(added, isEmpty,
          reason: 'an empty activity must not be stored (Save is never disabled, only dimmed, and '
              'neither the app nor the server checks the title); on screen: $shown');
    } finally {
      await removeNew(before);
    }
  });

  patrolTest('the form is empty when Other Activities is opened again after a save',
      config: benchConfig, ($) async {
    final before = await activityIds();
    try {
      await openOtherActivities($);
      await titleField($).enterText('QA activity ${DateTime.now().millisecondsSinceEpoch}');
      await achievementsField($).enterText('QA leftover achievement');
      await save($);
      await $('Other Activities').tap();
      await $.pump(const Duration(seconds: 2));
      dumpScreen($, 'reopened');
      expect(textOf($, titleField($)), isEmpty, reason: 'the saved title is cleared');
      expect(textOf($, achievementsField($)), isEmpty,
          reason: 'the saved achievements are cleared too (settings_controller.dart '
              'clearActivityDetails clears achieveMentscontroller, the Experience field, instead of '
              'activityAchieveMentscontroller)');
    } finally {
      await removeNew(before);
    }
  });
}
