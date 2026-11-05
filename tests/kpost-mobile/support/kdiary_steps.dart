import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/KDiary/views/screens/kdiary_task_view_screen.dart';
import 'package:kpost5_2023/KDiary/views/widgets/add_kdiary_bottomsheet.dart';
import 'package:kpost5_2023/KDiary/views/widgets/enable_kool_kall_bottomsheet.dart';
import 'package:kpost5_2023/KDiary/views/widgets/enable_remainder_bottomsheet.dart';
import 'package:kpost5_2023/KDiary/views/widgets/kdiary_add_schedule_widget.dart';
import 'package:kpost5_2023/KDiary/views/widgets/kdiary_daily_repeate_schedule_bottomsheet.dart';
import 'package:kpost5_2023/KDiary/views/widgets/kdiary_priority_bottomsheet.dart';
import 'package:kpost5_2023/KDiary/views/widgets/kdiary_repeated_add_schedule_widget.dart';
import 'package:kpost5_2023/KDiary/views/widgets/kdiary_repeated_priority_bottomsheet.dart';
import 'package:kpost5_2023/KDiary/views/widgets/repeated_schedule_bottomsheet.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:patrol/patrol.dart';

import './first_run.dart';

/// The KDiary screens as the phone shows them, mapped from the Test_ENV source (lib/KDiary):
///
/// - reached from the drawer: "KDiary" (base_controller.dart drawerList, 'kdiary'.tr; also a Home
///   tile and Quick Access, which open the same route AppRoutes.kdiaryScreen);
/// - KDiaryTaskViewScreen (kdiary_task_view_screen.dart): the Today list (the account's own
///   schedules starting today, remarks ≠ 6 "Deleted"; dairySchedule/getTodaySchedules), one card per
///   schedule: "HH:mm - HH:mm", the title (tap → KDiaryTaskDetailsBottomSheet with "Edit" while the
///   start is still ahead) and a "Remarks" side (tap → KDiaryRemarksScreen). The ⋮ (KP_31_More)
///   opens KDiaryShareBottomSheet (Share / Put On Hold / Reschedule / Stop / Delete); the FAB
///   (KP_45_Add) opens AddKDiaryBottomSheet ("Add Schedule" / "Add Report");
/// - KDiaryAddScheduleScreen: tabs "One Time" (KdiaryAddScheduleWidget) and "Repeated"
///   (KdiaryRepeatedAddScheduleWidget). One Time's Save refuses, in order, a blank Title / Subject,
///   a blank Description, no From, no To, no Priority, Reminder off, no participant, Kool Kall off,
///   and (new schedules) a start not later than now. Repeated's Save checks nothing.
/// - From/To are Material time pickers (showTimePicker; kdiary_controller.dart
///   oneTimeFromTimePicker refuses a From earlier than now, oneTimeToTimePicker a To before From,
///   each with the snackbar "Please select correct time" and the field left empty).

/// Drawer › KDiary, signed in on a fresh install; waits for the Today list to load.
Future<void> openKDiary(PatrolIntegrationTester $) async {
  await signInWithPassword($);
  await $(find.byIcon(KPOST.KP_20_Menu_Open)).tap();
  await tapDrawerItem($, 'KDiary');
  await $(KDiaryTaskViewScreen).waitUntilVisible();
  await $.pump(const Duration(seconds: 3));
}

/// FAB › Add Schedule: the Add Schedule screen on its One Time tab.
Future<void> openAddSchedule(PatrolIntegrationTester $) async {
  await $(FloatingActionButton).tap();
  await $(AddKDiaryBottomSheet).$('Add Schedule').tap();
  await $(KdiaryAddScheduleWidget).waitUntilVisible();
  await $.pump(const Duration(seconds: 1));
}

PatrolFinder oneTimeForm(PatrolIntegrationTester $) => $(KdiaryAddScheduleWidget);
PatrolFinder repeatedForm(PatrolIntegrationTester $) => $(KdiaryRepeatedAddScheduleWidget);

/// Scrolls [target] into view inside [formType]'s own scroll view (the form's SingleChildScrollView
/// is the first Scrollable under it; the Description field has its own further down the tree).
Future<PatrolFinder> reveal(PatrolFinder target, Type formType) => target.scrollTo(
      view: find.descendant(of: find.byType(formType), matching: find.byType(Scrollable)).first,
    );

/// A text field of [form] found by its hint ('Title / Subject', 'Enter Description', 'From', 'To').
PatrolFinder field(PatrolFinder form, String hint) => form.$(TextField).containing(hint);

String textOf(PatrolIntegrationTester $, PatrolFinder form, String hint) =>
    $.tester.widget<TextField>(field(form, hint).first).controller?.text ?? '';

/// Opens the time picker behind [timeField] and sets [at] by typing it in the picker's text-input
/// mode (the keyboard icon), with AM/PM when the phone uses a 12-hour clock; OK confirms.
Future<void> typeTime(PatrolIntegrationTester $, PatrolFinder timeField, DateTime at) async {
  await timeField.tap();
  final dialog = $(TimePickerDialog);
  await dialog.waitUntilVisible();
  await dialog.$(find.byIcon(Icons.keyboard_outlined)).tap();
  await $.pump(const Duration(milliseconds: 500));
  final use24 = MediaQuery.alwaysUse24HourFormatOf($.tester.element(find.byType(TimePickerDialog)));
  final hour = use24 ? at.hour : (at.hour % 12 == 0 ? 12 : at.hour % 12);
  await dialog.$(TextField).at(0).enterText('$hour');
  await dialog.$(TextField).at(1).enterText(at.minute.toString().padLeft(2, '0'));
  if (!use24) await dialog.$(at.hour < 12 ? 'AM' : 'PM').tap();
  await dialog.$('OK').tap();
  await $.pump(const Duration(seconds: 1));
}

/// Opens the time picker behind [timeField] and accepts what it offers (OK).
Future<void> acceptPickerTime(PatrolIntegrationTester $, PatrolFinder timeField) async {
  await timeField.tap();
  await $(TimePickerDialog).waitUntilVisible();
  await $(TimePickerDialog).$('OK').tap();
  await $.pump(const Duration(seconds: 1));
}

/// Fills the One Time form. A null [title]/[description] leaves that field blank. [from] is typed
/// into From ([fromNow] instead accepts the picker's own start, the current minute); with neither,
/// From and To stay empty. [to] null accepts the To picker's default (From + 30 min); [setTo] false
/// leaves To alone (its picker does not open while From is empty). [reminder], [participant] and
/// [koolKall] switch on what Save requires.
Future<void> fillOneTime(
  PatrolIntegrationTester $, {
  String? title,
  String? description,
  DateTime? from,
  bool fromNow = false,
  DateTime? to,
  bool setTo = true,
  bool priority = true,
  bool reminder = true,
  bool participant = true,
  bool koolKall = true,
}) async {
  final form = oneTimeForm($);
  const type = KdiaryAddScheduleWidget;
  if (title != null) await field(form, 'Title / Subject').enterText(title);
  if (description != null) await field(form, 'Enter Description').enterText(description);
  if (from != null || fromNow) {
    final fromField = await reveal(field(form, 'From'), type);
    if (fromNow) {
      await acceptPickerTime($, fromField);
    } else {
      await typeTime($, fromField, from!);
    }
    if (setTo) {
      final toField = await reveal(field(form, 'To'), type);
      if (to == null) {
        await acceptPickerTime($, toField);
      } else {
        await typeTime($, toField, to);
      }
    }
  }
  if (priority) {
    await (await reveal(form.$('Select Priority'), type)).tap();
    await $(KDiaryPriorityBottomSheet).$('High').tap();
    await $.pump(const Duration(milliseconds: 500));
  }
  if (reminder) {
    // The switch opens "Reminder Enable": Before <n> <unit> › Set.
    await (await reveal(form.$(Switch).at(0), type)).tap();
    await $(EnableRemainderBottomsheet).waitUntilVisible();
    await $(EnableRemainderBottomsheet).$(TextField).enterText('10');
    await $(EnableRemainderBottomsheet).$('Set').tap();
    await $.pump(const Duration(milliseconds: 500));
  }
  if (participant) {
    // Participants' + opens the Kool Kall "Add Members" picker (koolkall/views/addMembers.dart),
    // the same screen kool_kall_test.dart drives.
    await (await reveal(form.$(find.byIcon(KPOST.KP_45_Add)), type)).tap();
    await $(TextField).containing('Search').enterText('Qatest8');
    await $('Qatest8 Bench').tap();
    await $(find.byIcon(Icons.check)).tap();
    await oneTimeForm($).waitUntilVisible();
    await $.pump(const Duration(seconds: 1));
  }
  if (koolKall) {
    await (await reveal(form.$(Switch).at(1), type)).tap();
    await $(EnableKoolKallBottomsheet).$('Confirm').tap();
    await $.pump(const Duration(milliseconds: 500));
  }
}

/// Clears the app's snackbars (one can sit over Save) and taps [form]'s Save; returns the screen.
Future<String> tapSave(PatrolIntegrationTester $, PatrolFinder form, Type formType) async {
  for (final messenger in find.byType(ScaffoldMessenger).evaluate()) {
    ((messenger as StatefulElement).state as ScaffoldMessengerState).clearSnackBars();
  }
  await $.pump(const Duration(milliseconds: 500));
  await (await reveal(form.$(ElevatedButton).containing('Save'), formType)).tap();
  await $.pump(const Duration(milliseconds: 800));
  final shown = dumpScreen($, 'after Save');
  await $.pump(const Duration(seconds: 3));
  return shown;
}

/// Fills the Repeated tab: Daily for the next week, today's default times (From = now + 10 min,
/// To = From + 40 min), High priority. A null [title] leaves Title / Subject blank. No reminder, no
/// participant, no Kool Kall (Repeated's Save does not require them, and a repeated Kool Kall would
/// schedule a whole series of calls).
Future<void> fillRepeated(
  PatrolIntegrationTester $, {
  String? title,
  required String description,
}) async {
  await $(Tab).containing('Repeated').tap();
  await repeatedForm($).waitUntilVisible();
  await $.pump(const Duration(seconds: 1));
  final form = repeatedForm($);
  const type = KdiaryRepeatedAddScheduleWidget;
  // "Select Repeated Schedule" is the label and also the box's placeholder (the last one).
  await (await reveal(form.$('Select Repeated Schedule').last, type)).tap();
  await $(KDiaryRepeatedScheduleBottomSheet).$('Daily').tap();
  await $.pump(const Duration(milliseconds: 500));
  // Schedule Period appears once a type is chosen; its placeholder is the same text again.
  await (await reveal(form.$('Select Repeated Schedule').last, type)).tap();
  await $(KDiaryDailyRepeatedScheduleBottomSheet).$('Next One Week').tap();
  await $.pump(const Duration(milliseconds: 500));
  if (title != null) {
    await (await reveal(field(form, 'Title / Subject'), type)).enterText(title);
  }
  await (await reveal(field(form, 'Enter Description'), type)).enterText(description);
  await acceptPickerTime($, await reveal(field(form, 'From'), type));
  await acceptPickerTime($, await reveal(field(form, 'To'), type));
  await (await reveal(form.$('Select Priority'), type)).tap();
  await $(KDiaryRepeatedPriorityBottomSheet).$('High').tap();
  await $.pump(const Duration(milliseconds: 500));
}

/// The Today list's card that shows [title]: the nearest Row around the title that also holds the
/// card's "Remarks" side (or, in Delete's selection mode, its Checkbox).
PatrolFinder card(PatrolIntegrationTester $, String title, {Object holding = 'Remarks'}) => $(
      find.ancestor(
        of: find.descendant(of: find.byType(KDiaryTaskViewScreen), matching: find.text(title)),
        matching: find.byType(Row),
      ),
    ).containing(holding);

/// Whether the Today list shows [title], waiting up to [seconds] for the list to refresh.
Future<bool> listed(PatrolIntegrationTester $, String title, {int seconds = 10}) async {
  for (var i = 0; i < seconds; i++) {
    if ($(KDiaryTaskViewScreen).$(title).exists) return true;
    await $.pump(const Duration(seconds: 1));
  }
  return $(KDiaryTaskViewScreen).$(title).exists;
}

/// Whether [title] has left the Today list, waiting up to [seconds].
Future<bool> unlisted(PatrolIntegrationTester $, String title, {int seconds = 10}) async {
  for (var i = 0; i < seconds; i++) {
    if (!$(KDiaryTaskViewScreen).$(title).exists) return true;
    await $.pump(const Duration(seconds: 1));
  }
  return !$(KDiaryTaskViewScreen).$(title).exists;
}

/// A time today, truncated to the minute.
DateTime todayAt(Duration fromNow) {
  final t = DateTime.now().add(fromNow);
  return DateTime(t.year, t.month, t.day, t.hour, t.minute);
}

/// The test's one-time slot must start and end today, in the hours where the server's UTC "today"
/// (dairySchedule/getTodaySchedules) is the phone's (IST) today too.
bool slotFitsToday(DateTime start, DateTime end) {
  final now = DateTime.now();
  return now.hour >= 7 && end.day == now.day && start.day == now.day;
}

/// "HH:mm", as the form and the Today list show a time.
String hhmm(DateTime t) =>
    '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

String unique(String what) => 'QA $what ${DateTime.now().millisecondsSinceEpoch}';
