import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:kpost5_2023/settings/views/screens/kmail_settings/instant_reply_screen.dart';
import 'package:patrol/patrol.dart';

import '../../support/bench.dart';
import '../../support/first_run.dart';
import '../../support/peer_api.dart';
import '../../support/settings_api.dart';

/// Settings › KMail Settings › Instant Reply on the phone (instant_reply_screen.dart: the list of
/// replies, "Add New", an edit and a delete icon on the user's own rows; the "Instant Reply Message"
/// sheet with the "Enter your Instant Reply Message" field and "Add"; the "Delete Instant Reply
/// Message" dialog). instant_reply_controller.dart saves through the KMail API
/// (kmailSetting/saveOrUpdateCustomizedInstantReply {instantReply}, deleteCustomizedInstantReply {id},
/// common/getInstantReply/). A reply added on the phone must be kept by the server, a blank one must
/// not be saved, and one deleted on the phone must be gone from the server. Everything a test adds is
/// deleted over the API afterwards.
void main() {
  String unique(String what) => 'QA $what ${DateTime.now().millisecondsSinceEpoch}';

  /// Drawer › Settings › KMail Settings › Instant Reply, with the list loaded.
  Future<void> openInstantReply(PatrolIntegrationTester $) async {
    await signInWithPassword($);
    await $(find.byIcon(KPOST.KP_20_Menu_Open)).tap();
    await tapDrawerItem($, 'Settings');
    if (await $.platform.mobile.isPermissionDialogVisible(timeout: const Duration(seconds: 3))) {
      await $.platform.mobile.grantPermissionWhenInUse();
    }
    await $(ListTile).containing('KMail Settings').scrollTo().tap();
    await $(ListTile).containing('Instant Reply').scrollTo().tap();
    await $(InstantReplyScreen).waitUntilVisible();
    await $('Add New').waitUntilVisible();
    await $.pump(const Duration(seconds: 2));
  }

  PatrolFinder field(PatrolIntegrationTester $) =>
      $(TextField).containing('Enter your Instant Reply Message');

  /// "Add New", [text] typed into the sheet, "Add", then a wait for the list to reload.
  Future<String> addOnPhone(PatrolIntegrationTester $, String text) async {
    await $('Add New').tap();
    await $('Instant Reply Message').waitUntilVisible();
    await field($).enterText(text);
    await $(ElevatedButton).containing('Add').tap();
    await $.pump(const Duration(seconds: 3));
    return dumpScreen($, 'after Add');
  }

  /// Deletes every reply of the account's own that was not there before the test (cleanup).
  Future<void> removeNew(Set<String> before) async {
    try {
      final api = await ApiUser.phoneAccountForCleanup();
      for (final id in (await api.instantReplyIds()).difference(before)) {
        await api.deleteInstantReply(id);
      }
    } catch (e) {
      // ignore: avoid_print
      print('BENCH-CLEANUP instant replies not removed: $e');
    }
  }

  patrolTest('an Instant Reply added on the phone is listed and kept by the server',
      config: benchConfig, ($) async {
    final before = await (await ApiUser.phoneAccountForCleanup()).instantReplyIds();
    final text = unique('instant reply');
    try {
      await openInstantReply($);
      final shown = await addOnPhone($, text);
      expect($('Instant Reply Message'), findsNothing,
          reason: 'the sheet closes after Add; on screen: $shown');
      expect($(text), findsOneWidget, reason: 'the new reply is listed once; on screen: $shown');

      // Signs in as the phone's account, which ends the phone's session: the phone is done.
      final rows = (await (await ApiUser.phoneAccountForCleanup()).instantReplies())
          .where((r) => r['instantReply'] == text)
          .toList();
      expect(rows, hasLength(1), reason: 'the server keeps the reply once; on screen: $shown');
      expect(rows.first['customized'], isTrue,
          reason: "the server marks it as the user's own reply (${rows.first})");
    } finally {
      await removeNew(before);
    }
  });

  patrolTest('a blank Instant Reply is not saved', config: benchConfig, ($) async {
    final before = await (await ApiUser.phoneAccountForCleanup()).instantReplyIds();
    try {
      await openInstantReply($);
      final shown = await addOnPhone($, '     ');
      expect($('Instant Reply Message'), findsOneWidget,
          reason: 'Add with only spaces keeps the sheet open (instant_reply_screen.dart checks '
              'text.trim()); on screen: $shown');

      final added =
          (await (await ApiUser.phoneAccountForCleanup()).instantReplyIds()).difference(before);
      expect(added, isEmpty, reason: 'nothing is stored for a blank reply; on screen: $shown');
    } finally {
      await removeNew(before);
    }
  });

  patrolTest('an Instant Reply deleted on the phone is gone from the server', config: benchConfig,
      ($) async {
    final setup = await ApiUser.phoneAccountForCleanup();
    final before = await setup.instantReplyIds();
    final text = unique('instant reply to delete');
    await setup.addInstantReply(text);
    try {
      await openInstantReply($);
      final row = $(Row).containing(text);
      await row.waitUntilVisible();
      await row.$(find.byIcon(Icons.delete_outline)).tap();
      await $('Delete Instant Reply Message').waitUntilVisible();
      await $(ElevatedButton).containing('Delete').tap();
      await $.pump(const Duration(seconds: 3));
      final shown = dumpScreen($, 'after Delete');
      expect($(text), findsNothing, reason: 'the deleted reply leaves the list; on screen: $shown');

      // Signs in as the phone's account, which ends the phone's session: the phone is done.
      final left = (await (await ApiUser.phoneAccountForCleanup()).instantReplies())
          .where((r) => r['instantReply'] == text);
      expect(left, isEmpty, reason: 'the server no longer has the reply; on screen: $shown');
    } finally {
      await removeNew(before);
    }
  });
}
