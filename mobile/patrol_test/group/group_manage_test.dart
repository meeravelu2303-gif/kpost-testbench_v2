import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:kpost5_2023/app_common/views/screens/group_details_screen.dart';
import 'package:kpost5_2023/katchup/views/screens/katchup_screens/edit_group_screen.dart';
import 'package:patrol/patrol.dart';

import '../support/bench.dart';
import '../support/first_run.dart';
import '../support/group_api.dart';
import '../support/peer_api.dart';
import '../support/group_steps.dart';

/// Managing a group on the phone from Group Info (group_details_screen.dart,
/// group_operation_bottom_sheet_widget.dart, edit_group_screen.dart; create_group_controller.dart
/// onPressEditGroupName → group/editGroupName, onPressedRemoveGroupMember → group/removeGroupMember/,
/// onPressedAddUserToGroup → group/addUserToGroup/, onPressedExitFromGroup → group/leaveFromGroup/,
/// deleteGroup → group/deleteGroup/).
///
/// Each group is made over the API before the phone signs in (the server posts a "new group" message
/// into it, so it is in Katchup's list): by the phone's account when the phone must be its admin, by
/// qatest8 when the phone is a plain member who leaves. What the phone did is read back as qatest8
/// (safe at any time); the group is disbanded by its creator at the end.
void main() {
  String unique() => 'QA group ${DateTime.now().millisecondsSinceEpoch}';

  /// Disbands a group the phone's account created (that API sign-in ends the phone's session, so it
  /// runs last) and lets qatest8 drop it from its own list; removes the contact if the test added it.
  Future<void> cleanUpPhoneGroup(ApiUser peer, Map<String, dynamic>? group,
      {bool addedContact = false}) async {
    try {
      final phone = await ApiUser.phoneAccountForCleanup();
      if (group != null) {
        await phone.disbandGroup(group['groupID'] as int, '${group['groupKpostID']}');
        await peer.deleteGroup(group['groupID'] as int);
      }
      if (addedContact) await phone.deleteContact(Bench.peerId);
    } catch (error) {
      // ignore: avoid_print
      print('group_manage_test cleanup failed (group ${group?['groupKpostName']}): $error');
    }
  }

  patrolTest('renaming a group on the phone changes its name on the server', config: benchConfig,
      ($) async {
    final name = unique();
    final renamed = '$name renamed';
    final peer = await ApiUser.peer();
    Map<String, dynamic>? group;
    try {
      group = await (await ApiUser.phoneAccountForCleanup())
          .createGroup(name, members: {Bench.peerId: peerName});
      await signInWithPassword($);
      await openGroupInfo($, name);
      await openGroupMenu($);
      await $('Edit Group').tap();
      await $(EditGroupInfo).waitUntilVisible();
      // The only text field on Edit Group is the name (edit_group_screen.dart, letters, digits and
      // spaces only, 50 characters).
      await $(EditGroupInfo).$(TextFormField).enterText(renamed);
      await $(EditGroupInfo).$('Change').tap();
      await $.pump(const Duration(seconds: 4));
      final shown = dumpScreen($, 'after Change');

      final after = await peer.waitForGroup(
          (g) => g['groupID'] == group!['groupID'] && g['groupKpostName'] == renamed);
      final now = await peer.groupByKpostId('${group['groupKpostID']}');
      expect(after, isNotNull,
          reason: 'the other user sees the new name "$renamed" (server has '
              '"${now?['groupKpostName']}"); on screen: $shown');
    } finally {
      await cleanUpPhoneGroup(peer, group);
    }
  });

  patrolTest('a member removed on the phone is no longer in the group', config: benchConfig,
      ($) async {
    final name = unique();
    final peer = await ApiUser.peer();
    Map<String, dynamic>? group;
    try {
      group = await (await ApiUser.phoneAccountForCleanup())
          .createGroup(name, members: {Bench.peerId: peerName});
      final start = await peer.groupByKpostId('${group['groupKpostID']}');
      expect(GroupApi.isActiveMember(start, Bench.peerId), isTrue,
          reason: 'the other user starts as a member: ${start?['memberDetails']}');

      await signInWithPassword($);
      await openGroupInfo($, name);
      await openGroupMenu($);
      await $('Remove Members').tap();
      await $.pump(const Duration(seconds: 1));
      await $(GroupDetailsScreen).$(textIgnoringCase('qatest8')).first.tap();
      await $.pump(const Duration(milliseconds: 500));
      await $(GroupDetailsScreen).$(Icons.check).last.tap();
      await $.pump(const Duration(seconds: 4));
      final shown = dumpScreen($, 'after removing the member');

      final after = await peer.waitForGroup(
          (g) =>
              g['groupKpostID'] == group!['groupKpostID'] &&
              !GroupApi.isActiveMember(g, Bench.peerId),
          timeout: const Duration(seconds: 15));
      final now = await peer.groupByKpostId('${group['groupKpostID']}');
      expect(now == null || after != null, isTrue,
          reason: 'the removed user is no longer a member (their row: '
              '${GroupApi.memberRow(now, Bench.peerId)}); on screen: $shown');
    } finally {
      await cleanUpPhoneGroup(peer, group);
    }
  });

  patrolTest('a member added on the phone becomes a member of the group', config: benchConfig,
      ($) async {
    final name = unique();
    final peer = await ApiUser.peer();
    Map<String, dynamic>? group;
    var addedContact = false;
    var readded = false;
    try {
      final phone = await ApiUser.phoneAccountForCleanup();
      addedContact = await phone.ensureContact(Bench.peerId);
      try {
        group = await phone.createGroup(name);
      } on StateError {
        // The server may want a member besides the creator: start with qatest8 and remove them,
        // so the phone adds them back.
        group = await phone.createGroup(name, members: {Bench.peerId: peerName});
        await phone.removeGroupMembers(
            group['groupID'] as int, '${group['groupKpostID']}', [Bench.peerId]);
        readded = true;
      }

      await signInWithPassword($);
      await openGroupInfo($, name);
      await $(GroupDetailsScreen).$(KPOST.KP_107_User_Add).first.tap();
      await pickPeer($);
      await $.pump(const Duration(seconds: 3));
      final shown = dumpScreen($, 'after adding the member');

      final after = await peer.waitForGroup((g) =>
          g['groupKpostID'] == group!['groupKpostID'] && GroupApi.isActiveMember(g, Bench.peerId));
      final now = await peer.groupByKpostId('${group['groupKpostID']}');
      expect(after, isNotNull,
          reason: 'the added user is a member of "$name"'
              '${readded ? ' (they had been removed from it before: a re-add)' : ''}; their row: '
              '${GroupApi.memberRow(now, Bench.peerId)}; on screen: $shown');
    } finally {
      await cleanUpPhoneGroup(peer, group, addedContact: addedContact);
    }
  });

  patrolTest('a member leaves a group on the phone and then deletes it from their list',
      config: benchConfig, ($) async {
    final name = unique();
    final peer = await ApiUser.peer();
    Map<String, dynamic>? group;
    try {
      // qatest8 creates the group with the phone as a plain member: a member may exit (the creator
      // could not while it is the only admin), and Delete is offered only after exiting
      // (GroupOperationBottomSheetWidget isDelete).
      final me = await (await ApiUser.phoneAccountForCleanup()).profile();
      final myName = '${me['firstName'] ?? ''} ${me['lastName'] ?? ''}'.trim();
      group = await peer.createGroup(name, members: {Bench.kpostId: myName});

      await signInWithPassword($);
      await openGroupInfo($, name);
      await openGroupMenu($);
      await $('Exit Group').tap();
      await $('You Want to Exit the Group').waitUntilVisible();
      await $(TextButton).containing('Confirm').tap();
      await $.pump(const Duration(seconds: 4));
      final afterExit = dumpScreen($, 'after Exit Group');

      final left = await peer.waitForGroup((g) =>
          g['groupKpostID'] == group!['groupKpostID'] && !GroupApi.isActiveMember(g, Bench.kpostId));
      final now = await peer.groupByKpostId('${group['groupKpostID']}');
      expect(left, isNotNull,
          reason: "the phone's account has left the group (its row: "
              '${GroupApi.memberRow(now, Bench.kpostId)}); on screen: $afterExit');

      await openGroupMenu($);
      await $(ElevatedButton).containing('Delete').waitUntilVisible();
      await $(ElevatedButton).containing('Delete').tap();
      await $.pump(const Duration(seconds: 5));
      final afterDelete = dumpScreen($, 'after Delete');

      // The phone is done: read its own side (this sign-in ends the phone's session).
      final mine = (await (await ApiUser.phoneAccountForCleanup()).myGroups())
          .where((g) => g['groupKpostID'] == group!['groupKpostID'])
          .firstOrNull;
      final myRow = GroupApi.memberRow(mine, Bench.kpostId);
      expect(mine == null || '${myRow?['remarks']}'.toLowerCase() == 'group deleted', isTrue,
          reason: "the deleted group is gone from the phone's account (its row: $myRow); "
              'on screen: $afterDelete');
    } finally {
      if (group != null) {
        await peer.disbandGroup(group['groupID'] as int, '${group['groupKpostID']}');
      }
    }
  });
}
