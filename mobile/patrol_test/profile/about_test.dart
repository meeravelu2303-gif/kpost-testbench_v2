import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:patrol/patrol.dart';

import '../support/bench.dart';
import '../support/first_run.dart';
import '../support/peer_api.dart';

/// Profile "About": Drawer › Settings › Profile Creation › About, edit, Update (about_your_self.dart).
/// The server must hold the new text afterwards. The original text is read over the API before the
/// phone signs in, and put back at the end.
void main() {
  patrolTest('the user edits About in Profile Creation and the server keeps the new text',
      config: benchConfig, ($) async {
    final original = await (await ApiUser.phoneAccountForCleanup()).about();
    final marker = 'QA bench about ${DateTime.now().millisecondsSinceEpoch}';

    try {
      await signInWithPassword($);

      await $(find.byIcon(KPOST.KP_20_Menu_Open)).tap();
      await $(Drawer).$('Settings').scrollTo().tap();
      await $('Profile Creation').tap();
      await $('About').tap();

      final about = $(TextField).containing('Enter About You...');
      await (about.exists ? about : $(TextField).first).enterText(marker);
      await $('Update').tap();
      await $('About Successfully Updated').waitUntilVisible();

      // Signs in as the phone's account, which ends the phone's session: the phone is done.
      final account = await ApiUser.phoneAccountForCleanup();
      expect(await account.about(), marker, reason: 'the server holds the new About text');
    } finally {
      await (await ApiUser.phoneAccountForCleanup()).setAbout(original);
    }
  });
}
