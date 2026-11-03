import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:patrol/patrol.dart';

import '../support/bench.dart';
import '../support/first_run.dart';
import '../support/peer_api.dart';

/// Profile "About": Drawer › Settings › Profile Creation › About, edit, Update (about_your_self.dart,
/// settings_controller.dart aboutSelfUpdate). The server must hold the new text afterwards, and an
/// empty or blank About must not replace the stored one. The original text is read over the API
/// before the phone signs in, and put back at the end.
void main() {
  Future<void> openAbout(PatrolIntegrationTester $) async {
    await signInWithPassword($);
    await $(find.byIcon(KPOST.KP_20_Menu_Open)).tap();
    await tapDrawerItem($, 'Settings');
    await $('Profile Creation').tap();
    await $('About').tap();
    await $.pump(const Duration(seconds: 1));
  }

  PatrolFinder aboutField(PatrolIntegrationTester $) {
    final hinted = $(TextField).containing('Enter About You...');
    return hinted.exists ? hinted : $(TextField).first;
  }

  bool updateEnabled(PatrolIntegrationTester $) {
    final button = find.ancestor(of: find.text('Update'), matching: find.byWidgetPredicate(
        (w) => w is ButtonStyleButton));
    return $.tester.widget<ButtonStyleButton>(button.first).onPressed != null;
  }

  patrolTest('the user edits About in Profile Creation and the server keeps the new text',
      config: benchConfig, ($) async {
    final original = await (await ApiUser.phoneAccountForCleanup()).about();
    final marker = 'QA bench about ${DateTime.now().millisecondsSinceEpoch}';
    try {
      await openAbout($);
      await aboutField($).enterText(marker);
      await $('Update').tap();
      await $('About Successfully Updated').waitUntilVisible();

      // Signs in as the phone's account, which ends the phone's session: the phone is done.
      final account = await ApiUser.phoneAccountForCleanup();
      expect(await account.about(), marker, reason: 'the server holds the new About text');
    } finally {
      await (await ApiUser.phoneAccountForCleanup()).setAbout(original);
    }
  });

  patrolTest('About opens with the stored text, and Update is off while it is empty',
      config: benchConfig, ($) async {
    final api = await ApiUser.phoneAccountForCleanup();
    final original = await api.about();
    final marker = 'QA bench stored about ${DateTime.now().millisecondsSinceEpoch}';
    try {
      await api.setAbout(marker);
      await openAbout($);
      final shown = dumpScreen($, 'About opened');
      expect($.tester.widget<TextField>(aboutField($).first).controller?.text, marker,
          reason: 'the field shows the About the server holds; on screen: $shown');
      await aboutField($).enterText('');
      await $.pump(const Duration(milliseconds: 500));
      expect(updateEnabled($), isFalse, reason: 'an empty About cannot be submitted');
    } finally {
      await (await ApiUser.phoneAccountForCleanup()).setAbout(original);
    }
  });

  patrolTest('a blank About (spaces only) does not replace the stored one and says why',
      config: benchConfig, ($) async {
    final api = await ApiUser.phoneAccountForCleanup();
    final original = await api.about();
    final marker = 'QA bench kept about ${DateTime.now().millisecondsSinceEpoch}';
    try {
      await api.setAbout(marker);
      await openAbout($);
      await aboutField($).enterText('    ');
      await $('Update').tap();
      await $.pump(const Duration(seconds: 3));
      final shown = dumpScreen($, 'after blank Update');
      expect(await (await ApiUser.phoneAccountForCleanup()).about(), marker,
          reason: 'spaces only must not replace the stored About');
      expect($(SnackBar), findsWidgets,
          reason: 'the user is told why nothing happened (aboutSelfUpdate returns silently on a '
              'blank text, with Update enabled); on screen: $shown');
    } finally {
      await (await ApiUser.phoneAccountForCleanup()).setAbout(original);
    }
  });
}
