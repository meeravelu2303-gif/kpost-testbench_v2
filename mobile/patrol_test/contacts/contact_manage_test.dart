import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:kpost5_2023/settings/views/screens/digital_card_type/user_digital_card_type.dart';
import 'package:kpost_common/app_common/views/widgets/common_widgets/custom_checkbox_widget.dart';
import 'package:patrol/patrol.dart';

import '../support/bench.dart';
import '../support/contacts_api.dart';
import '../support/first_run.dart';
import '../support/kdirectory_api.dart';
import '../support/peer_api.dart';

/// Managing a contact on the phone. Mapped from the Test_ENV source:
/// - Add: the app has no manual "add by KPost ID" form. Contacts are added from KDirectory (the Contacts
///   tab's KP_107_User_Add icon opens it too, contacts_list_widget.dart → onTapAddcontactKdirectory): either
///   the card's "Add Contact" (contacts/add_contact_test.dart) or a result row's CustomCheckbox and the
///   "Add to Contact" button (kdirectory_search_screen.dart → KdirectoryController.addContactKpost →
///   addContactFromAPI, which then opens the "Add Reference To" popup, add_reference_popup.dart). So the
///   invalid inputs a user can give are KDirectory searches: their own KPost ID, an ID nobody has, nothing.
/// - Edit: a contact's editable field is its reference name: Home › Contacts › the contact › its card
///   (UserDigitalCardTypes) › the reference chip → the same popup, saved by
///   ContactsController.saveReferenceNameWithKatchup (contacts/addContactReference/). Save does nothing while
///   the field is empty (isEnableSave).
/// - Delete: not offered. UserDigitalCardTypes takes a deleteContact callback but draws no button for it,
///   and OtherUserDigitalCardWidget (which had one) is not used anywhere, so there is no delete test.
/// - Block / unblock: Settings › General Settings › Blocked Contacts (blocked_contacts.dart): "+" (KP_45_Add)
///   lists the contacts to pick with a Checkbox, the check icon asks "Block Contacts" › Confirm; a blocked
///   row's block icon asks "Unblock Contact" › Unblock (ContactsController.onTapBlockContactMultiple,
///   contacts/blockOrUnBlockMultipleContact).
/// The second user (qatest8) is the contact. Every test reads the result back over the API once the phone
/// part is done and puts the second user's contact row back as it was in finally.
void main() {
  String unique(String what) => 'QA $what ${DateTime.now().millisecondsSinceEpoch}';

  /// The second user's first and last name, from their own profile.
  Future<({String first, String last})> peerName() async {
    final p = await (await ApiUser.peer()).profile();
    return (first: '${p['firstName'] ?? ''}'.trim(), last: '${p['lastName'] ?? ''}'.trim());
  }

  /// Puts the second user's row in the phone account's address book back to [original] (null = not a
  /// contact). Never throws: a cleanup failure is printed for review.
  Future<void> restorePeer(Map<String, dynamic>? original) async {
    try {
      final api = await ApiUser.phoneAccountForCleanup();
      await api.deleteContact(Bench.peerId);
      if (original == null) return;
      await api.addContact(Bench.peerId);
      final reference = '${original['referenceName'] ?? ''}';
      if (reference.isNotEmpty && reference != 'null') {
        await api.setReference(Bench.peerId, reference,
            firstName: '${original['firstName'] ?? ''}', lastName: '${original['lastName'] ?? ''}');
      }
      if (original['isBlocked'] == true) await api.setBlocked(Bench.peerId, true);
    } catch (e) {
      // ignore: avoid_print
      print('BENCH-CLEANUP-FAILED contacts: could not restore ${Bench.peerId}: $e');
    }
  }

  /// The second user as a plain contact of the phone account (no reference, not blocked) before the
  /// phone signs in, returning the row as it was before.
  Future<Map<String, dynamic>?> startWithPeerAsContact({String? reference}) async {
    final api = await ApiUser.phoneAccountForCleanup();
    final original = await api.contactRow(Bench.peerId);
    await api.deleteContact(Bench.peerId);
    await api.addContact(Bench.peerId);
    if (reference != null) {
      final name = await peerName();
      await api.setReference(Bench.peerId, reference, firstName: name.first, lastName: name.last);
    }
    return original;
  }

  Future<Map<String, dynamic>?> peerRowAfterPhone() async =>
      (await ApiUser.phoneAccountForCleanup()).contactRow(Bench.peerId);

  /// The "Add Reference To" popup (add_reference_popup.dart): its field's hint is "Add Reference".
  PatrolFinder referenceField(PatrolIntegrationTester $) =>
      $(TextFormField).containing('Add Reference');

  /// Home › Contacts tab › search (home_header.dart: the KP_30_Search icon, then a field whose hint is
  /// "Search") › the second user › their card.
  Future<void> openPeerCardFromContacts(PatrolIntegrationTester $, String first, String shown) async {
    await $(Tab).containing('Contacts').tap();
    await $.pump(const Duration(seconds: 2));
    await $(find.byIcon(KPOST.KP_30_Search)).first.tap();
    await $(TextFormField).containing('Search').enterText(first);
    await $.pump(const Duration(seconds: 2));
    // The list title-cases names (appUtils.capitalizeEachWord) and may highlight the match.
    await $(shown).first.tap();
    await $(UserDigitalCardTypes).waitUntilVisible();
    await $.pump(const Duration(seconds: 2));
  }

  /// Drawer › Settings › General Settings › Blocked Contacts.
  Future<void> openBlockedContacts(PatrolIntegrationTester $) async {
    await $(find.byIcon(KPOST.KP_20_Menu_Open)).tap();
    await tapDrawerItem($, 'Settings');
    await $(ListTile).containing('General Settings').tap();
    await $('Blocked Contacts').scrollTo().tap();
    await $('Blocked Contact List').waitUntilVisible();
    await $.pump(const Duration(seconds: 1));
  }

  patrolTest(
      'a contact added from KDirectory with its checkbox and "Add to Contact" is kept by the server '
      'with its reference', config: benchConfig, ($) async {
    final reference = unique('ref').toUpperCase();
    final api = await ApiUser.phoneAccountForCleanup();
    final original = await api.contactRow(Bench.peerId);
    await api.deleteContact(Bench.peerId);
    try {
      await signInWithPassword($);
      await openKDirectorySearch($);
      final listed = await searchKDirectory($, Bench.peerId);
      expect(kdirectoryRow(Bench.peerId), findsOneWidget,
          reason: '${Bench.peerId} is listed; on screen: $listed');
      await $(find.descendant(
              of: kdirectoryRow(Bench.peerId), matching: find.byType(CustomCheckbox)))
          .tap();
      await $('Add to Contact').tap();

      // addContactFromAPI opens "Add Reference To" for a single Personal contact.
      var popup = false;
      for (var second = 0; second < 15 && !popup; second++) {
        await $.pump(const Duration(seconds: 1));
        popup = $('Add Reference To').exists;
      }
      final shown = dumpScreen($, 'after Add to Contact');
      if (popup) {
        // UpperCaseTextFormatter upper-cases a first entry typed in one go, so the name is upper case.
        await referenceField($).enterText(reference);
        await $(ElevatedButton).containing('Save').tap();
        await $.pump(const Duration(seconds: 3));
      }
      final saved = dumpScreen($, 'after Save');

      final row = await peerRowAfterPhone();
      expect(row, isNotNull, reason: 'the server keeps ${Bench.peerId} as a contact; on screen: $shown');
      expect(popup, isTrue,
          reason: 'adding one Personal contact asks for a reference ("Add Reference To"); '
              'on screen: $shown');
      expect('${row?['referenceName'] ?? ''}'.toUpperCase(), reference,
          reason: 'the server keeps the reference typed in the popup; on screen: $saved');
    } finally {
      await restorePeer(original);
    }
  });

  patrolTest("editing a contact's reference from its card changes it on the server",
      config: benchConfig, ($) async {
    final before = unique('ref').toUpperCase();
    final after = unique('ref edited').toUpperCase();
    final name = await peerName();
    final original = await startWithPeerAsContact(reference: before);
    try {
      await signInWithPassword($);
      await openPeerCardFromContacts($, name.first, capitalizeWords('${name.first} ${name.last}'));
      final card = dumpScreen($, 'contact card');
      expect($(UserDigitalCardTypes).$(textExactly(before)), findsOneWidget,
          reason: 'the card shows the current reference "$before"; on screen: $card');
      await $(UserDigitalCardTypes).$(textExactly(before)).tap();
      await $('Add Reference To').waitUntilVisible();
      expect($.tester.widget<TextFormField>(referenceField($).first).controller?.text, before,
          reason: 'the popup opens with the current reference filled in');
      await referenceField($).enterText(after);
      await $(ElevatedButton).containing('Save').tap();
      await $.pump(const Duration(seconds: 3));
      final shown = dumpScreen($, 'after Save');

      final row = await peerRowAfterPhone();
      expect('${row?['referenceName'] ?? ''}', after,
          reason: 'the server keeps the edited reference; on screen: $shown');
    } finally {
      await restorePeer(original);
    }
  });

  patrolTest("a blank reference is not saved over a contact's reference", config: benchConfig,
      ($) async {
    final before = unique('ref').toUpperCase();
    final name = await peerName();
    final original = await startWithPeerAsContact(reference: before);
    try {
      await signInWithPassword($);
      await openPeerCardFromContacts($, name.first, capitalizeWords('${name.first} ${name.last}'));
      await $(UserDigitalCardTypes).$(textExactly(before)).tap();
      await $('Add Reference To').waitUntilVisible();
      await referenceField($).enterText('');
      await $(ElevatedButton).containing('Save').tap();
      await $.pump(const Duration(seconds: 3));
      final shown = dumpScreen($, 'after Save with a blank reference');
      expect($('Add Reference To'), findsOneWidget,
          reason: 'Save with an empty reference does nothing and the popup stays; on screen: $shown');

      final row = await peerRowAfterPhone();
      expect('${row?['referenceName'] ?? ''}', before,
          reason: 'the server still has the reference "$before"');
    } finally {
      await restorePeer(original);
    }
  });

  patrolTest('blocking a contact from Settings › Blocked Contacts is kept by the server',
      config: benchConfig, ($) async {
    final name = await peerName();
    final fullName = '${name.first} ${name.last}'.trim();
    final original = await startWithPeerAsContact();
    try {
      await signInWithPassword($);
      await openBlockedContacts($);
      await $(find.byIcon(KPOST.KP_45_Add)).tap();
      await $.pump(const Duration(seconds: 1));
      // searchContactForBlock matches the contact's full name, ignoring case.
      await $(TextField).containing('Search').enterText(fullName.toLowerCase());
      await $.pump(const Duration(seconds: 2));
      final picked = dumpScreen($, 'block picker');
      expect($(Checkbox), findsOneWidget,
          reason: 'the search for "$fullName" leaves exactly that contact to pick; on screen: $picked');
      await $(Checkbox).tap();
      await $(find.byIcon(Icons.check)).tap();
      await $('Block Contacts').waitUntilVisible();
      await $('Confirm').tap();
      await $.pump(const Duration(seconds: 3));
      final shown = dumpScreen($, 'after Confirm');

      final row = await peerRowAfterPhone();
      expect(row?['isBlocked'], isTrue,
          reason: 'the server has ${Bench.peerId} blocked; on screen: $shown');
    } finally {
      await restorePeer(original);
    }
  });

  patrolTest('unblocking a contact from the Blocked Contacts list is kept by the server',
      config: benchConfig, ($) async {
    final name = await peerName();
    final shownName = capitalizeWords('${name.first} ${name.last}');
    final original = await startWithPeerAsContact();
    try {
      await (await ApiUser.phoneAccountForCleanup()).setBlocked(Bench.peerId, true);
      await signInWithPassword($);
      await openBlockedContacts($);
      final list = dumpScreen($, 'blocked list');
      expect(textExactly(shownName), findsOneWidget,
          reason: '$shownName is in the Blocked Contact List; on screen: $list');
      // The row's block icon (Icons.block; the header uses KP_109_User_Block).
      final row = find.ancestor(of: textExactly(shownName), matching: find.byType(Container)).first;
      await $(find.descendant(of: row, matching: find.byIcon(Icons.block))).tap();
      await $('Unblock Contact').waitUntilVisible();
      await $(ElevatedButton).containing('Unblock').tap();
      await $.pump(const Duration(seconds: 3));
      final shown = dumpScreen($, 'after Unblock');
      expect(textExactly(shownName), findsNothing,
          reason: '$shownName leaves the Blocked Contact List; on screen: $shown');

      final stored = await peerRowAfterPhone();
      expect(stored?['isBlocked'], isNot(true),
          reason: 'the server no longer has ${Bench.peerId} blocked');
    } finally {
      await restorePeer(original);
    }
  });

  patrolTest('the user cannot add themselves: KDirectory does not list their own KPost ID',
      config: benchConfig, ($) async {
    await signInWithPassword($);
    await openKDirectorySearch($);
    final shown = await searchKDirectory($, Bench.kpostId);
    expect(kdirectoryRow(Bench.kpostId), findsNothing,
        reason: 'a search for the user\'s own KPost ID offers no row to add; on screen: $shown');

    final self = await (await ApiUser.phoneAccountForCleanup()).contactRow(Bench.kpostId);
    expect(self, isNull, reason: 'the user is not in their own address book');
  });

  patrolTest(
      'a KPost ID nobody has cannot be added, and "Add to Contact" with nobody selected adds nothing',
      config: benchConfig, ($) async {
    final before = await (await ApiUser.phoneAccountForCleanup()).contactIds();
    final nobody = 'qanobody${DateTime.now().millisecondsSinceEpoch}';
    try {
      await signInWithPassword($);
      await openKDirectorySearch($);
      final shown = await searchKDirectory($, nobody);
      expect(kdirectoryResultRows(), findsNothing,
          reason: 'nobody is listed for "$nobody"; on screen: $shown');
      await $('Add to Contact').tap();
      await $.pump(const Duration(seconds: 2));
      // A blank search lists nobody either (hasActiveSearchQuery is false).
      await kdirectorySearchField($).enterText('');
      await $.pump(const Duration(seconds: 2));
      expect(kdirectoryResultRows(), findsNothing, reason: 'an empty search lists nobody');
      await $('Add to Contact').tap();
      await $.pump(const Duration(seconds: 2));
      final after = dumpScreen($, 'after Add to Contact with nothing selected');

      final now = await (await ApiUser.phoneAccountForCleanup()).contactIds();
      expect(now.difference(before), isEmpty,
          reason: 'no contact was added; on screen: $after');
    } finally {
      // Removes anything that was added by mistake.
      final api = await ApiUser.phoneAccountForCleanup();
      for (final id in (await api.contactIds()).difference(before)) {
        await api.deleteContact(id);
      }
    }
  });
}
