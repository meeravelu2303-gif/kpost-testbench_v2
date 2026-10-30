import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:patrol/patrol.dart';

import '../support/bench.dart';
import '../support/first_run.dart';
import '../support/peer_api.dart';

/// KDirectory: find another KPost user and add them to the address book (kdirectory_screen_widget,
/// kdirectory_search_results_widget, user_digital_card_type.dart). The second user is removed from
/// the phone account's contacts first, so the add is a real one, and removed again at the end (the
/// app has no delete in its current UI).
void main() {
  patrolTest('the user finds another user in KDirectory and adds them as a contact',
      config: benchConfig, ($) async {
    const peerName = 'Qatest8 Bench';
    await (await ApiUser.phoneAccountForCleanup()).deleteContact(Bench.peerId);

    try {
      await signInWithPassword($);

      await $(BottomNavigationBar).$('KDirectory').tap();
      await $.pump(const Duration(seconds: 2));
      // First visit: country, language and vertical, then Continue.
      if ($('Continue').exists || $('Select Country').exists) {
        await $('Select Country').tap();
        await $('India').tap();
        await $('Select Language').tap();
        await $('English').tap();
        await $('Personal').tap();
        await $('Continue').tap();
      }

      // The field capitalises its first letter; the search waits for typing to stop.
      await $(TextFormField).containing('Search Contacts').enterText('qatest8');
      await $(peerName).waitUntilVisible();
      await $(peerName).tap();

      await $('Add Contact').tap();
      await $('Contacts Added Successfully').waitUntilVisible();
      // The reference popup that follows is optional.
      if ($('Add Reference').exists) await $('Cancel').tap();

      // Signs in as the phone's account, which ends the phone's session: the phone is done.
      final account = await ApiUser.phoneAccountForCleanup();
      expect(await account.contactIds(), contains(Bench.peerId.toLowerCase()),
          reason: 'the server holds the new contact');
    } finally {
      await (await ApiUser.phoneAccountForCleanup()).deleteContact(Bench.peerId);
    }
  });
}
