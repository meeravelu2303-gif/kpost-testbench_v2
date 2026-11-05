import 'package:flutter/material.dart';
import 'package:flutter_list_view/flutter_list_view.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:kpost5_2023/app_common/views/screens/group_details_screen.dart';
import 'package:kpost5_2023/app_common/views/widgets/common_widgets/katchup_header_widget.dart';
import 'package:kpost5_2023/katchup/views/screens/katchup_screens/group_creation_selected_contact_screen.dart';
import 'package:kpost5_2023/katchup/views/screens/katchup_screens/katchup_dashboard_screen.dart';
import 'package:kpost5_2023/katchup/views/screens/katchup_screens/new_group_creation_screen.dart';
import 'package:patrol/patrol.dart';

/// The group screens on the phone, shared by the group tests. Groups live inside Katchup:
/// - create: Katchup › "Contacts" tab (home_header.dart renderTabHeader) › the KP_112_Group_Add box
///   icon (contacts_list_widget.dart, onTapGroupCreation) opens NewGroupCreationScreen ("Create New
///   Group": the "Group name" field, "Add Members", the "Create" KPOSTButton, which stays disabled
///   while the name is empty: create_group_controller.dart isGroupNameEnable);
/// - pick members: GroupCreationSelectedContactScreen (the "Search" field, a row per contact, the
///   Icons.check tick at the bottom); the same screen adds members to an existing group;
/// - group info: the group's chat header (KatchupMessageHeader, katchup_message_screen.dart
///   _openGroupDetails) opens GroupDetailsScreen ("Group Info": KP_107_User_Add adds members for an
///   admin, KP_144___More_Vertical opens GroupOperationBottomSheetWidget with "Edit Group",
///   "Remove Members", "Exit Group", and "Delete" once the user has left).

/// The display name of the second user in the phone's contacts (as in kool_kall_test.dart).
const peerName = 'Qatest8 Bench';

/// A Text or RichText whose text contains [text], ignoring case: lists title-case names
/// (capitalizeEachWord turns "QA group 1" into "Qa Group 1").
Finder textIgnoringCase(String text) {
  final wanted = text.toLowerCase();
  return find.byWidgetPredicate((w) {
    final shown = w is Text
        ? (w.data ?? w.textSpan?.toPlainText())
        : w is RichText
            ? w.text.toPlainText()
            : null;
    return shown != null && shown.toLowerCase().contains(wanted);
  });
}

/// Katchup › Contacts › the group-add icon: the "Create New Group" screen.
Future<void> openCreateGroup(PatrolIntegrationTester $) async {
  await $(BottomNavigationBar).$('Katchup').tap();
  await $(KatchupDashboardScreen).waitUntilVisible();
  await $(Tab).containing('Contacts').tap();
  await $.pump(const Duration(seconds: 2));
  await $(KPOST.KP_112_Group_Add).first.tap();
  await $(NewGroupCreationScreen).waitUntilVisible();
}

/// On the member picker (opened by "Add Members" or Group Info's add icon): searches for the second
/// user, ticks them and confirms with the check button.
Future<void> pickPeer(PatrolIntegrationTester $) async {
  final picker = $(GroupCreationSelectedContactScreen);
  await picker.waitUntilVisible();
  await picker.$(TextField).containing('Search').enterText('Qatest8');
  await $.pump(const Duration(seconds: 2));
  await picker.$(peerName).waitUntilVisible();
  await picker.$(peerName).tap();
  await $.pump(const Duration(milliseconds: 500));
  await picker.$(Icons.check).last.tap();
  await $.pump(const Duration(seconds: 2));
}

/// The "Create" button of the Create New Group screen.
Finder createButton() => find.descendant(
      of: find.byType(NewGroupCreationScreen),
      matching: find.widgetWithText(ElevatedButton, 'Create'),
    );

/// True when the Create button can be pressed.
bool createEnabled(PatrolIntegrationTester $) =>
    $.tester.widget<ElevatedButton>(createButton().first).onPressed != null;

/// Katchup › the group's conversation (found by its name) › the chat header: Group Info.
Future<void> openGroupInfo(PatrolIntegrationTester $, String groupName) async {
  await $(BottomNavigationBar).$('Katchup').tap();
  await $(KatchupDashboardScreen).waitUntilVisible();
  final row = $(KatchupDashboardScreen).$(textIgnoringCase(groupName));
  if (!await appears(row)) {
    await $.tester.fling(find.byType(FlutterListView).first, const Offset(0, 500), 1500);
    await $.pumpAndSettle();
  }
  await row.first.waitUntilVisible();
  await row.first.tap();
  await $(KatchupMessageHeader).waitUntilVisible();
  await $(KatchupMessageHeader).tap();
  await $(GroupDetailsScreen).waitUntilVisible();
  await $.pump(const Duration(seconds: 2));
}

/// Group Info › the more (⋮) icon: the group operations sheet.
Future<void> openGroupMenu(PatrolIntegrationTester $) async {
  await $(GroupDetailsScreen).$(KPOST.KP_144___More_Vertical).tap();
  await $.pump(const Duration(seconds: 1));
}

/// True when [finder] shows up within 10 seconds.
Future<bool> appears(PatrolFinder finder) async {
  try {
    await finder.first.waitUntilVisible(timeout: const Duration(seconds: 10));
    return true;
  } on WaitUntilVisibleTimeoutException {
    return false;
  }
}
