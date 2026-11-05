import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:kpost5_2023/settings/views/screens/digital_card_settings.dart';
import 'package:patrol/patrol.dart';

import '../../support/bench.dart';
import '../../support/first_run.dart';
import '../../support/peer_api.dart';
import '../../support/settings_api.dart';

/// Settings › Digital Card Settings on the phone (digital_card_settings.dart: one row per part of the
/// profile, its title, "Visible on Digital Card" / "Hidden from Digital Card" under it, and a switch;
/// tapping the row flips it). Each flip saves at once (settings_controller.dart
/// updateDigitalCardPrivacySetting -> profile/updatePrivacySettingDetails with
/// DigitalCardPrivacyRequestModel: mobile, about, school, college, university, experience,
/// otherActivity as "true"/"false"), and the row changes only when the server answers 200. The server
/// keeps the map as userProfile.privacyDetails, read back as the phone's account after the phone part.
///
/// Only "About" is flipped (Mobile Number stays as it is: the public card would show the number).
/// The app starts from its own preferences (a fresh install: About shown, everything else hidden) and
/// sends the whole map on every flip, so the other parts must still be what the server had: a phone
/// that overwrites them with its defaults is a finding. The original map is read before the phone
/// signs in and written back afterwards whenever it changed.
///
/// Watch on the first run: the backend copy (UserProfileServiceImpl.updatePrivacySettingDetails) reads
/// a single `privacyDetails` string and answers 400 to the flat map the app (and the web) sends; if the
/// QA server matches that copy, the row does not change and the test fails as the finding.
void main() {
  const about = 'About';

  /// The About row's subtitle ("Visible on Digital Card" / "Hidden from Digital Card").
  PatrolFinder aboutRow(PatrolIntegrationTester $) => $(InkWell).containing(about);

  /// Puts the server's privacy map back when the test changed it (cleanup; never throws).
  Future<void> restore(Map<String, dynamic>? original) async {
    try {
      final api = await ApiUser.phoneAccountForCleanup();
      final now = await api.privacyDetails();
      if ('$now' == '$original') return;
      if (original == null) {
        // ignore: avoid_print
        print('BENCH-CLEANUP privacy map was empty before the test and cannot be emptied again; '
            'now $now');
        return;
      }
      final status = await api.setPrivacyDetails(original);
      // ignore: avoid_print
      print('BENCH-CLEANUP privacy map restored: HTTP $status (was $original)');
    } catch (e) {
      // ignore: avoid_print
      print('BENCH-CLEANUP privacy map not restored: $e');
    }
  }

  patrolTest('About hidden from the Digital Card on the phone is kept by the server, '
      'and the other parts are left as they were', config: benchConfig, ($) async {
    final original = await (await ApiUser.phoneAccountForCleanup()).privacyDetails();
    try {
      await signInWithPassword($);
      await $(find.byIcon(KPOST.KP_20_Menu_Open)).tap();
      await tapDrawerItem($, 'Settings');
      if (await $.platform.mobile.isPermissionDialogVisible(timeout: const Duration(seconds: 3))) {
        await $.platform.mobile.grantPermissionWhenInUse();
      }
      await $(ListTile).containing('Digital Card Settings').scrollTo().tap();
      await $(DigitalCardSettings).waitUntilVisible();
      await $.pump(const Duration(seconds: 1));

      final before = dumpScreen($, 'Digital Card Settings');
      expect(aboutRow($).$('Visible on Digital Card'), findsOneWidget,
          reason: 'a fresh install shows About on the card (loadDigitalCardVisibilitySettings); '
              'on screen: $before');

      await $(about).tap();
      await $.pump(const Duration(seconds: 3));
      final shown = dumpScreen($, 'after hiding About');
      expect(aboutRow($).$('Hidden from Digital Card'), findsOneWidget,
          reason: 'the About row shows it is hidden once the server accepted it; on screen: $shown');

      // Signs in as the phone's account, which ends the phone's session: the phone is done.
      final stored = await (await ApiUser.phoneAccountForCleanup()).privacyDetails();
      expect(settingsFlag(stored, 'about'), isFalse,
          reason: 'the server keeps About hidden (privacyDetails: $stored); on screen: $shown');
      for (final key in const ['mobile', 'school', 'college', 'university', 'experience', 'otherActivity']) {
        final was = settingsFlag(original, key);
        if (was == null) continue; // nothing stored before: the phone's default is all there is
        expect(settingsFlag(stored, key), was,
            reason: 'hiding About leaves "$key" as the server had it ($original), '
                'not the phone\'s default (privacyDetails now: $stored)');
      }
    } finally {
      await restore(original);
    }
  });
}
