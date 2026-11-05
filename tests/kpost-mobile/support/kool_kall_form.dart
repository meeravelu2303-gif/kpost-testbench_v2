import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:kpost5_2023/app_common/views/widgets/button/kpost_button.dart';
import 'package:kpost5_2023/koolkall/views/koolkallView.dart';
import 'package:kpost5_2023/koolkall/views/widget/todays_koolkall_list_widget.dart';
import 'package:patrol/patrol.dart';

import './bench.dart';
import './first_run.dart';
import './kall_api.dart';
import './peer_api.dart';

/// Shared steps for the Kool Kall phone tests (not a test file itself). Everything is read from the
/// Test_ENV source:
/// - the form: koolkall/views/koolkallView.dart (title 'Create Schedule Kall' / 'Reschedule Kall',
///   'Enter meeting name' hint, a date field with a calendar_month_rounded icon, From / To fields with a
///   timer_outlined icon each, ' Invite ', the 'Create Kool Kall' / 'Reschedule Kall' KPOSTButton);
/// - its rules: koolkall/controller/kool_controller.dart (datePicker: no day before today;
///   fromTimePicker: dial only, no time before now today; toTimePicker: no To before From, no time
///   before now today; OnPressedSubmit: title, date, From, To and a participant are required);
/// - the snackbars it shows: utils/app_utils.dart showToastMessage → a Text in a SnackBar for 2 s.

/// Kall (bottom bar) › Kool Kall tab › + opens the Create Schedule Kall form (kall_dashboard_screen.dart
/// FloatingActionButton with KPOST.KP_45_Add → AppRoutes.createkoolkallscreen).
Future<void> openKoolKallTab(PatrolIntegrationTester $) async {
  await $(BottomNavigationBar).$('Kall').tap();
  await $('Kool Kall').tap();
  await $.pump(const Duration(seconds: 2));
}

Future<void> openCreateForm(PatrolIntegrationTester $) async {
  await openKoolKallTab($);
  await $(find.byIcon(KPOST.KP_45_Add)).tap();
  await $('Create Schedule Kall').waitUntilVisible();
}

/// Scrolls [target] into view inside the form's own scroll view (the Kall screen below it stays
/// mounted, so a bare scrollTo() could pick that screen's list).
Future<PatrolFinder> reveal(PatrolIntegrationTester $, PatrolFinder target) => target.scrollTo(
      view: find
          .descendant(of: find.byType(KoolKallView), matching: find.byType(Scrollable))
          .first,
    );

/// The meeting title field (hint 'enter_meeting_name'.tr = 'Enter meeting name').
PatrolFinder titleField(PatrolIntegrationTester $) => $(TextField).containing('Enter meeting name');

/// The text in the form field whose hint is [hint]: 'Enter meeting name', 'DD/MM/YYYY' (the date,
/// kept as yyyy-MM-dd), 'From' / 'To' (kept as HH:mm).
String fieldText(PatrolIntegrationTester $, String hint) {
  final field =
      find.byWidgetPredicate((w) => w is TextField && w.decoration?.hintText == hint);
  if (field.evaluate().isEmpty) return '<no field "$hint">';
  return $.tester.widget<TextField>(field.first).controller?.text ?? '';
}

/// yyyy-MM-dd, the way the form keeps a date (DateTimeUtils.yyyyMmDd).
String ymd(DateTime d) =>
    '${d.year}-${'${d.month}'.padLeft(2, '0')}-${'${d.day}'.padLeft(2, '0')}';

/// The pickers open from the fields' suffix IconButtons (their onPressed calls the picker directly).
Future<void> openDatePicker(PatrolIntegrationTester $) async =>
    (await reveal($, $(find.byIcon(Icons.calendar_month_rounded)).first)).tap();
Future<void> openFromPicker(PatrolIntegrationTester $) async =>
    (await reveal($, $(find.byIcon(Icons.timer_outlined)).at(0))).tap();
Future<void> openToPicker(PatrolIntegrationTester $) async =>
    (await reveal($, $(find.byIcon(Icons.timer_outlined)).at(1))).tap();

/// In the open date picker (calendar showing [shownMonth]), moves to [day]'s month and taps the day,
/// then OK. A day before today is disabled (firstDate = today), so tapping one changes nothing.
Future<void> pickDay(PatrolIntegrationTester $, DateTime day, {required DateTime shownMonth}) async {
  await $(DatePickerDialog).waitUntilVisible();
  var months = (day.year - shownMonth.year) * 12 + day.month - shownMonth.month;
  for (; months > 0; months--) {
    await $(find.byTooltip('Next month')).tap();
    await $.pump(const Duration(milliseconds: 500));
  }
  await $(find.descendant(of: find.byType(DatePickerDialog), matching: find.text('${day.day}')))
      .first
      .tap();
  await $('OK').tap();
}

/// In the open time picker (the To picker: its entry mode is not locked to the dial, unlike From's
/// TimePickerEntryMode.dialOnly), switches to typing and enters [time], then OK.
Future<void> typeTime(PatrolIntegrationTester $, DateTime time) async {
  await $(TimePickerDialog).waitUntilVisible();
  await $(find.byIcon(Icons.keyboard_outlined)).tap(); // 'Switch to text input mode'
  await $.pump(const Duration(milliseconds: 500));
  final dialog = find.byType(TimePickerDialog);
  final use24 = MediaQuery.of($.tester.element(dialog)).alwaysUse24HourFormat;
  final hour = use24 ? time.hour : (time.hour % 12 == 0 ? 12 : time.hour % 12);
  final fields = find.descendant(of: dialog, matching: find.byType(TextField));
  await $(fields.at(0)).enterText('$hour'.padLeft(2, '0'));
  await $(fields.at(1)).enterText('${time.minute}'.padLeft(2, '0'));
  if (!use24) {
    await $(find.descendant(of: dialog, matching: find.text(time.hour < 12 ? 'AM' : 'PM'))).tap();
  }
  await $('OK').tap();
}

/// ' Invite ' → Add Members (koolkall/views/addMembers.dart): search, tick the second user, ✓.
Future<void> inviteSecondUser(PatrolIntegrationTester $) async {
  await (await reveal($, $(' Invite '))).tap();
  await $(TextField).containing('Search').enterText('Qatest8');
  await $('Qatest8 Bench').tap();
  await $(find.byIcon(Icons.check)).tap();
  await $.pump(const Duration(seconds: 1));
}

/// Taps the form's footer button ('Create Kool Kall', or 'Reschedule Kall' when editing).
Future<void> submit(PatrolIntegrationTester $, String label) async =>
    (await reveal($, $(KPOSTButton).containing(label))).tap();

/// Whether a snackbar with exactly [text] shows within [seconds] (each lasts 2 s).
Future<bool> snackShown(PatrolIntegrationTester $, String text, {int seconds = 4}) async {
  for (var i = 0; i < seconds * 4; i++) {
    if (find.text(text).evaluate().isNotEmpty) return true;
    await $.pump(const Duration(milliseconds: 250));
  }
  return find.text(text).evaluate().isNotEmpty;
}

/// After a create the app opens the Android share sheet with the meeting link
/// (AppShareUtils.shareText); Back leaves it without sharing. Back is pressed only while the app is
/// actually behind the sheet, so it can never pop the Kall screen instead.
Future<void> leaveShareSheet(PatrolIntegrationTester $) async {
  for (var i = 0; i < 16; i++) {
    await $.pump(const Duration(milliseconds: 250));
    if (WidgetsBinding.instance.lifecycleState != AppLifecycleState.resumed) {
      await $.platform.android.pressBack();
      await $.pump(const Duration(seconds: 1));
      return;
    }
  }
}

/// Creates a one-time Kool Kall titled [title] with the second user on [day] (a day after today), from
/// the phone: the date picker on [day], then From and To at the pickers' own defaults for a future day
/// (00:10 and 00:40, kool_controller.dart fromTimePicker / toTimePicker). Returns what the screen
/// showed and whether 'Kool Kall created' appeared.
Future<({bool created, String shown})> createKoolKall(
  PatrolIntegrationTester $, {
  required String title,
  required DateTime day,
}) async {
  await openCreateForm($);
  await titleField($).enterText(title);
  await openDatePicker($);
  await pickDay($, day, shownMonth: DateTime.now());
  await openFromPicker($);
  await $('OK').tap(); // 00:10 on that day
  await openToPicker($);
  await $('OK').tap(); // 00:40
  await inviteSecondUser($);
  await submit($, 'Create Kool Kall');
  final created = await snackShown($, 'Kool Kall created');
  final shown = dumpScreen($, 'after Create Kool Kall');
  if (created) await leaveShareSheet($);
  return (created: created, shown: shown);
}

/// The meeting's card on the Kool Kall tab (TodaysKoolKallCellWidget shows the title as given),
/// scrolled into view in that tab's list.
Future<PatrolFinder> koolKallCard(PatrolIntegrationTester $, String title) async {
  await $(TodaysKoolKallCellWidget).first.waitUntilExists();
  final list = find
      .ancestor(of: find.byType(TodaysKoolKallCellWidget).first, matching: find.byType(Scrollable))
      .first;
  return $(find.widgetWithText(TodaysKoolKallCellWidget, title)).scrollTo(view: list);
}

/// Local midnight + [minutes] on [day], as epoch milliseconds (what the form sends).
int slot(DateTime day, int minutes) =>
    DateTime(day.year, day.month, day.day).add(Duration(minutes: minutes)).millisecondsSinceEpoch;

/// Clean-up after the phone part: ends every Kool Kall the phone's account organised with one of
/// [titles] (kall/endKoolKall, status 8) and deletes the Katchup notices about them. Never throws.
Future<void> endKoolKallsTitled(List<String> titles) async {
  try {
    final organiser = await ApiUser.phoneAccountForCleanup();
    for (final row in await organiser.kallRows()) {
      final id = row['kallID'];
      if (titles.contains(row['subject']) && id is int) await organiser.endKoolKall(id);
    }
    for (final title in titles) {
      await organiser.deleteKallNotices(Bench.peerId, title);
    }
  } catch (e) {
    // ignore: avoid_print
    print('BENCH-CLEANUP kall: $e');
  }
}

/// Clean-up for a form that should have been refused: ends any Kool Kall from the phone's account that
/// the second user can see now and could not see [before]. Never throws.
Future<void> endKoolKallsSince(Set<int> before) async {
  try {
    final added = (await (await ApiUser.peer()).koolKallIdsFrom(Bench.kpostId)).difference(before);
    if (added.isEmpty) return;
    final organiser = await ApiUser.phoneAccountForCleanup();
    for (final id in added) {
      await organiser.endKoolKall(id);
    }
  } catch (e) {
    // ignore: avoid_print
    print('BENCH-CLEANUP kall: $e');
  }
}
