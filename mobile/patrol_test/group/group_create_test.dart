import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/views/screens/group_details_screen.dart';
import 'package:patrol/patrol.dart';

import '../support/bench.dart';
import '../support/first_run.dart';
import '../support/group_api.dart';
import '../support/peer_api.dart';
import '../support/group_steps.dart';

/// Katchup › Contacts › Create New Group on the phone (new_group_creation_screen.dart,
/// group_creation_selected_contact_screen.dart, create_group_controller.dart createGroup →
/// group/createUserGroup/). A group made with the second user must be kept by the server with both
/// members and the phone's account as admin, read back as qatest8 (safe at any time); a group with no
/// name (empty or only spaces) must not be created.
///
/// The member picker lists only the phone's contacts, so qatest8 is added to them over the API first
/// when missing (and removed again at the end). Every group a test makes is disbanded by the phone's
/// account at the very end (remove the members, then delete: admins cannot exit while they are the
/// only admin), and qatest8 drops it from its own list too.
void main() {
  /// The ids of qatest8's groups (every group these tests make includes qatest8).
  Future<Set<int>> peerGroupIds(ApiUser peer) async =>
      {for (final g in await peer.myGroups()) if (g['groupID'] is int) g['groupID'] as int};

  /// Disbands every group qatest8 is in now that was not there [before], as the phone's account
  /// (this API sign-in ends the phone's session, so it runs last), and removes the contact that
  /// [addedContact] says the test added.
  Future<void> cleanUp(ApiUser peer, Set<int> before, {required bool addedContact}) async {
    try {
      final created = [
        for (final g in await peer.myGroups())
          if (g['groupID'] is int && !before.contains(g['groupID'])) g,
      ];
      final phone = await ApiUser.phoneAccountForCleanup();
      for (final g in created) {
        await phone.disbandGroup(g['groupID'] as int, '${g['groupKpostID']}');
        await peer.deleteGroup(g['groupID'] as int);
      }
      if (addedContact) await phone.deleteContact(Bench.peerId);
    } catch (error) {
      // ignore: avoid_print
      print('group_create_test cleanup failed (check qatest7/qatest8 groups by hand): $error');
    }
  }

  patrolTest('a group created on the phone with another user is kept by the server for both',
      config: benchConfig, ($) async {
    final name = 'QA group ${DateTime.now().millisecondsSinceEpoch}';
    final peer = await ApiUser.peer();
    final before = await peerGroupIds(peer);
    final addedContact = await (await ApiUser.phoneAccountForCleanup()).ensureContact(Bench.peerId);
    try {
      await signInWithPassword($);
      await openCreateGroup($);
      await $('Add Members').tap();
      await pickPeer($);
      await $(TextFormField).containing('Group name').enterText(name);
      await $.pump(const Duration(milliseconds: 500));
      expect(createEnabled($), isTrue, reason: 'Create is active once a name and a member are given');
      await $.tester.tap(createButton().first);
      await $.pump(const Duration(seconds: 5));
      final shown = dumpScreen($, 'after Create');

      final group = await peer.waitForGroup((g) => g['groupKpostName'] == name);
      expect(group, isNotNull,
          reason: 'the other user is in the new group "$name"; on screen: $shown');
      expect('${group?['groupAdmin']}'.toLowerCase(), Bench.kpostId.toLowerCase(),
          reason: "the phone's account is the group's admin");
      expect(GroupApi.isActiveMember(group, Bench.kpostId), isTrue,
          reason: "the phone's account is a member: ${group?['memberDetails']}");
      expect(GroupApi.isActiveMember(group, Bench.peerId), isTrue,
          reason: 'the other user is a member: ${group?['memberDetails']}');
    } finally {
      await cleanUp(peer, before, addedContact: addedContact);
    }
  });

  patrolTest('a group with no name, or a name of only spaces, is not created', config: benchConfig,
      ($) async {
    final peer = await ApiUser.peer();
    final before = await peerGroupIds(peer);
    final addedContact = await (await ApiUser.phoneAccountForCleanup()).ensureContact(Bench.peerId);
    try {
      await signInWithPassword($);
      await openCreateGroup($);
      await $('Add Members').tap();
      await pickPeer($);

      // Empty name: Create stays disabled (create_group_controller.dart isGroupNameEnable).
      final empty = dumpScreen($, 'no group name');
      expect(createEnabled($), isFalse,
          reason: 'Create is disabled while the group name is empty; on screen: $empty');
      await $.tester.tap(createButton().first, warnIfMissed: false);
      await $.pump(const Duration(seconds: 3));

      // Only spaces: the controller clears a single typed space, but a name of several spaces
      // enables Create, and the server only checks for a missing name (GroupControllerV2
      // createUserGroup: KPOSTValidation.isEmpty(Object) is a null check).
      await $(TextFormField).containing('Group name').enterText('   ');
      await $.pump(const Duration(milliseconds: 500));
      final spaces = dumpScreen($, 'group name of spaces');
      final spacesEnabled = createEnabled($);
      await $.tester.tap(createButton().first, warnIfMissed: false);
      await $.pump(const Duration(seconds: 5));
      final shown = dumpScreen($, 'after Create with a blank name');

      final made = (await peer.myGroups())
          .where((g) => g['groupID'] is int && !before.contains(g['groupID']))
          .map((g) => '"${g['groupKpostName']}"')
          .toList();
      expect(made, isEmpty,
          reason: 'no group is created without a real name (Create was '
              '${spacesEnabled ? 'ENABLED' : 'disabled'} for a name of spaces; on screen: $spaces; '
              'after: $shown); created: $made');
      expect(spacesEnabled, isFalse,
          reason: 'Create stays disabled for a name of only spaces; on screen: $spaces');
      expect($(GroupDetailsScreen), findsNothing, reason: 'no group was opened');
    } finally {
      await cleanUp(peer, before, addedContact: addedContact);
    }
  });
}
