import 'peer_api.dart';

/// Groups over the KPost API, for the group tests' setup, read-back and cleanup. Every body is the
/// one the Flutter app sends (lib/app_common/models/api_models/request_model/create_group_request_model/*,
/// my_group_request_model.dart in kpost_common, lib/katchup/controller/create_group_controller.dart).
///
/// Endpoints (lib/app_common/constants/api_url_constants.dart; GroupControllerV2.java,
/// ContactsDirectoryControllerV2.java):
///   contacts/myGroups          {lastfetchDate: null}            → group_added / group_updated
///   group/createUserGroup/     CreateGroupRequestmodel          → data {groupID, groupKpostID, ...}
///   group/removeGroupMember/   {memberKpostIdList, groupID, groupKpostID}   (an admin only)
///   group/leaveFromGroup/      {id: '<own member row id>', groupID, groupKpostID}
///   group/deleteGroup/         {groupID}  (after leaving / being removed, or as the last member left)
///   contacts/addContact        AddContactRequestModel
///
/// A creator cannot leave while it is the only admin (create_group_controller.dart onPressExit), so a
/// group is cleaned up by its creator: remove every other member, then delete (GroupServiceDaoImpl
/// deleteGroup: "Group Deleted SuccessFully by Admin" once the admin is the only member left).
extension GroupApi on ApiUser {
  /// Every group this account belongs to, as contacts/myGroups returns them (group_added and
  /// group_updated merged; each has groupID, groupKpostID, groupKpostName, groupAdmin, memberDetails).
  Future<List<Map<String, dynamic>>> myGroups() async {
    final response = await dio.post<Object>('contacts/myGroups', data: {'lastfetchDate': null});
    if (response.statusCode != 200) {
      throw StateError('$kpostId: contacts/myGroups answered HTTP ${response.statusCode}');
    }
    final data = response.data;
    final groups = <Map<String, dynamic>>[];
    final seen = <String>{};
    if (data is Map) {
      for (final key in ['group_added', 'group_updated']) {
        final rows = data[key];
        for (final row in rows is List ? rows : const []) {
          if (row is Map && seen.add('${row['groupID']}')) {
            groups.add(row.map((k, v) => MapEntry('$k', v)));
          }
        }
      }
    }
    return groups;
  }

  /// The group called [name] in this account's groups (exact name), or null.
  Future<Map<String, dynamic>?> groupNamed(String name) async =>
      (await myGroups()).where((g) => g['groupKpostName'] == name).firstOrNull;

  /// The group [groupKpostId] in this account's groups, or null.
  Future<Map<String, dynamic>?> groupByKpostId(String groupKpostId) async =>
      (await myGroups()).where((g) => g['groupKpostID'] == groupKpostId).firstOrNull;

  /// Polls this account's groups for up to [timeout] until [test] finds one; null if none did.
  Future<Map<String, dynamic>?> waitForGroup(
    bool Function(Map<String, dynamic> group) test, {
    Duration timeout = const Duration(seconds: 20),
  }) async {
    final end = DateTime.now().add(timeout);
    while (true) {
      final found = (await myGroups()).where(test).firstOrNull;
      if (found != null || DateTime.now().isAfter(end)) return found;
      await Future<void>.delayed(const Duration(seconds: 2));
    }
  }

  /// The member row of [kpostId] in [group] (memberDetails[]), or null.
  static Map<String, dynamic>? memberRow(Map<String, dynamic>? group, String kpostId) {
    final members = group?['memberDetails'];
    for (final row in members is List ? members : const []) {
      if (row is Map && '${row['kpostID']}'.toLowerCase() == kpostId.toLowerCase()) {
        return row.map((k, v) => MapEntry('$k', v));
      }
    }
    return null;
  }

  /// True when [kpostId] is a current member of [group]: a member row that is not flagged removed
  /// and whose remarks are not 'removed' / 'left' / 'Group Deleted' (the server's own markers,
  /// GroupRepository.isUserAdminAndOnlyMemberInGroup).
  static bool isActiveMember(Map<String, dynamic>? group, String kpostId) {
    final row = memberRow(group, kpostId);
    if (row == null || row['removedFlag'] == true) return false;
    final remarks = '${row['remarks'] ?? ''}'.toLowerCase();
    return !['removed', 'left', 'group deleted'].contains(remarks);
  }

  /// Creates a group the way the app does (create_group_controller.dart createGroup): this account
  /// first as admin, then [members] (kpostID → display name) without admin access. Returns the
  /// response's `data` (groupID, groupKpostID, ...). Throws when the server refuses.
  Future<Map<String, dynamic>> createGroup(String name, {Map<String, String> members = const {}}) async {
    final me = await _me();
    final remarks = 'Created by ${me.name}';
    final response = await dio.post<Object>('group/createUserGroup/', data: {
      'activeStatus': 'Y',
      'createdBy': kpostId,
      'groupCreateAccess': true,
      'groupKpostName': name,
      'isPrivateGroup': 'Y',
      'memberDetails': [
        {
          'kpostID': kpostId,
          'name': me.name,
          'memberDesignation': me.designation,
          'hasAdminAccess': 'Y',
          'privacyStatus': 'Y',
          'remarks': remarks,
          'createdBy': kpostId,
        },
        for (final member in members.entries)
          {
            'kpostID': member.key,
            'name': member.value,
            'memberDesignation': null,
            'hasAdminAccess': 'N',
            'privacyStatus': 'Y',
            'remarks': remarks,
            'createdBy': kpostId,
          },
      ],
    });
    final body = response.data;
    final data = body is Map ? body['data'] : null;
    if (response.statusCode != 200 || data is! Map || data['groupID'] == null) {
      throw StateError('$kpostId could not create group "$name": HTTP ${response.statusCode} $body');
    }
    return data.map((k, v) => MapEntry('$k', v));
  }

  /// Removes [memberIds] from a group this account administers; returns the HTTP status.
  Future<int?> removeGroupMembers(int groupId, String groupKpostId, List<String> memberIds) async {
    final response = await dio.post<Object>('group/removeGroupMember/', data: {
      'memberKpostIdList': memberIds,
      'groupID': groupId,
      'groupKpostID': groupKpostId,
    });
    return response.statusCode;
  }

  /// Leaves a group by this account's own member row id; returns the HTTP status.
  Future<int?> leaveGroup(int groupId, String groupKpostId, int memberRowId) async {
    final response = await dio.post<Object>('group/leaveFromGroup/', data: {
      'id': '$memberRowId',
      'groupID': groupId,
      'groupKpostID': groupKpostId,
    });
    return response.statusCode;
  }

  /// Deletes a group from this account's side; returns the HTTP status.
  Future<int?> deleteGroup(int groupId) async {
    final response = await dio.post<Object>('group/deleteGroup/', data: {'groupID': groupId});
    return response.statusCode;
  }

  /// Cleanup by the group's creator: removes every other current member, then deletes the group.
  /// Failures are printed, never thrown.
  Future<void> disbandGroup(int groupId, String groupKpostId) async {
    try {
      final group = (await myGroups()).where((g) => g['groupID'] == groupId).firstOrNull;
      final members = group?['memberDetails'];
      final others = <String>[
        for (final row in members is List ? members : const [])
          if (row is Map &&
              '${row['kpostID']}'.toLowerCase() != kpostId.toLowerCase() &&
              isActiveMember(group, '${row['kpostID']}'))
            '${row['kpostID']}',
      ];
      if (others.isNotEmpty) await removeGroupMembers(groupId, groupKpostId, others);
      final status = await deleteGroup(groupId);
      if (status != 200) {
        // ignore: avoid_print
        print('group cleanup: deleteGroup $groupId as $kpostId answered HTTP $status');
      }
    } catch (error) {
      // ignore: avoid_print
      print('group cleanup failed for group $groupId ($groupKpostId) as $kpostId: $error');
    }
  }

  /// Makes sure [contactId] is in this account's address book (the group member picker lists only
  /// contacts: create_group_controller.dart toggleCheckbox reads knownContactList/unknownContactList).
  /// Sends what contacts_bl.dart addContactDetails sends (the caller's own first and last name, and
  /// its user type). Returns true when it added the contact, so the caller removes it again.
  Future<bool> ensureContact(String contactId) async {
    if ((await contactIds()).contains(contactId.toLowerCase())) return false;
    final p = await profile();
    final response = await dio.post<Object>('contacts/addContact', data: {
      'contactID': contactId,
      'firstName': p['firstName'],
      'lastName': p['lastName'],
      'userType': 'PERSONAL',
    });
    if (response.statusCode != 200) {
      throw StateError('$kpostId could not add $contactId as a contact: HTTP ${response.statusCode}');
    }
    return true;
  }

  Future<({String name, String? designation})> _me() async {
    final p = await profile();
    final userProfile = p['userProfile'];
    return (
      name: '${p['firstName'] ?? ''} ${p['lastName'] ?? ''}'.trim(),
      designation: userProfile is Map ? userProfile['designation'] as String? : null,
    );
  }
}
