import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/KDiary/views/screens/kdiary_remarks_screen.dart';
import 'package:kpost5_2023/KDiary/views/screens/kdiary_task_view_screen.dart';
import 'package:kpost5_2023/KDiary/views/widgets/kdiary_add_schedule_widget.dart';
import 'package:kpost5_2023/KDiary/views/widgets/kdiary_repeated_add_schedule_widget.dart';
import 'package:kpost5_2023/KDiary/views/widgets/kdiary_share_bottomsheet.dart';
import 'package:kpost5_2023/KDiary/views/widgets/kdiary_task_details_bottomsheet.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:patrol/patrol.dart';

import '../../support/bench.dart';
import '../../support/first_run.dart';
import '../../support/kdiary_api.dart';
import '../../support/peer_api.dart';
import '../../support/kdiary_steps.dart';

/// KDiary schedules on the phone: create (One Time and Repeated), edit, and the two ways the app
/// offers to delete one (Remarks › Delete, and ⋮ › Delete). Screens and rules: kdiary_steps.dart.
///
/// What a test makes is read back over the API: a One Time schedule always invites the peer
/// (qatest8; the app's Save requires a participant), so the peer reads it with
/// dairySchedule/getEvents at any time; a Repeated one (no participant) is read as the phone's
/// account once the phone part is done. Every schedule, and the Kool Kall the server schedules for a
/// One Time one, is removed over the API in `finally`.
void main() {
  Future<void> cleanup(String marker) async {
    try {
      await (await ApiUser.phoneAccountForCleanup()).removeDiaryItems(marker);
    } catch (e) {
      // ignore: avoid_print
      print('BENCH-CLEANUP: $e');
    }
  }

  /// The peer's view of the event [eventId] / titled [title].
  Future<List<Map<String, dynamic>>> peerRows({int? eventId, String? title}) async =>
      (await (await ApiUser.peer()).diaryEvents())
          .where((r) => (eventId != null && r['eventID'] == eventId) ||
              (title != null && r['title'] == title))
          .toList();

  patrolTest('a one-time schedule is saved, listed today, and kept by the server with its invitee',
      config: benchConfig, ($) async {
    final start = todayAt(const Duration(minutes: 90));
    final end = start.add(const Duration(minutes: 30));
    if (!slotFitsToday(start, end)) {
      markTestSkipped('the slot now + 90 min must fall on today, after 07:00');
      return;
    }
    final title = unique('kdiary');
    try {
      await openKDiary($);
      await openAddSchedule($);
      await fillOneTime($, title: title, description: '$title note', from: start);
      final form = oneTimeForm($);
      expect(textOf($, form, 'From'), hhmm(start), reason: 'From takes the typed time');
      expect(textOf($, form, 'To'), hhmm(end), reason: 'To offers From + 30 min');
      final shown = await tapSave($, form, KdiaryAddScheduleWidget);
      final isListed = await listed($, title);
      final list = dumpScreen($, 'Today list');
      expect(isListed, isTrue,
          reason: 'the new schedule is on the Today list; after Save: $shown; list: $list');
      expect($(KDiaryTaskViewScreen).$('${hhmm(start)} - ${hhmm(end)}'), findsWidgets,
          reason: 'its card shows the time slot');

      final rows = await peerRows(title: title);
      expect(rows, hasLength(1),
          reason: 'the server keeps the schedule once, and the invited peer can read it');
      final row = rows.first;
      expect(row['description'], '$title note');
      expect(row['priority'], 3, reason: 'High is stored as 3 (onPressAddSchedule)');
      expect(row['isKoolKall'], isTrue, reason: 'Kool Kall was switched on');
      expect(row['snoozeDetails'], 'Before 10 Minutes', reason: 'the reminder set on the phone');
      expect('${row['createdBy']}'.toLowerCase(), Bench.kpostId.toLowerCase());
      expect(KDiaryApi.participantsOf(row), contains(Bench.peerId.toLowerCase()),
          reason: 'the peer chosen in Add Members is the participant');
      final storedStart = KDiaryApi.diaryTime(row['scheduleStartDateAndTime']);
      final storedEnd = KDiaryApi.diaryTime(row['scheduleEndDateAndTime']);
      expect(storedStart == null ? null : hhmm(storedStart), hhmm(start),
          reason: 'the stored start is the time chosen');
      expect(storedEnd == null ? null : hhmm(storedEnd), hhmm(end),
          reason: 'the stored end is the time chosen');

      // The phone part is over: the owner's full row (reminder flag, Kool Kall id).
      final owner = await ApiUser.phoneAccountForCleanup();
      final full = (await owner.diaryEventsBetween(start, start))
          .where((r) => r['title'] == title)
          .toList();
      expect(full, hasLength(1), reason: "the schedule is in the owner's day");
      expect(full.first['isReminder'], isTrue, reason: 'the reminder is stored');
      expect(full.first['kallID'], isNot(0),
          reason: 'a Kool Kall was scheduled for it (KdiaryScheduleServiceImpl.createSchedule)');
    } finally {
      await cleanup(title);
    }
  });

  patrolTest('editing a schedule changes that schedule on the server, not a new one',
      config: benchConfig, ($) async {
    final start = todayAt(const Duration(hours: 2));
    final end = start.add(const Duration(minutes: 30));
    if (!slotFitsToday(start, end)) {
      markTestSkipped('the slot now + 2 h must fall on today, after 07:00');
      return;
    }
    final title = unique('kdiary');
    final renamed = '$title edited';
    try {
      final eventId = await (await ApiUser.phoneAccountForCleanup()).createOneTimeSchedule(
        title: title,
        description: '$title note',
        start: start,
        end: end,
        participants: [Bench.peerId],
      );
      await openKDiary($);
      expect(await listed($, title), isTrue,
          reason: 'the schedule is on the Today list; on screen: ${dumpScreen($, 'Today list')}');
      await $(KDiaryTaskViewScreen).$(title).tap();
      // "Edit" shows only while the start is still ahead (kdiary_task_details_bottomsheet.dart).
      await $(KDiaryTaskDetailsBottomSheet).$('Edit').tap();
      await oneTimeForm($).waitUntilVisible();
      await $.pump(const Duration(seconds: 1));
      final form = oneTimeForm($);
      expect(textOf($, form, 'Title / Subject'), title,
          reason: 'the form opens filled in; on screen: ${dumpScreen($, 'Edit Schedule')}');
      expect(textOf($, form, 'From'), hhmm(start), reason: 'with its start');
      await field(form, 'Title / Subject').enterText(renamed);
      await field(form, 'Enter Description').enterText('$renamed note');
      final shown = await tapSave($, form, KdiaryAddScheduleWidget);
      final isListed = await listed($, renamed);
      expect(isListed, isTrue,
          reason: 'the Today list shows the new title; after Save: $shown; list: '
              '${dumpScreen($, 'Today list')}');

      // The phone part is over: read as the owner (the edit rewrites the participant rows, so the
      // owner's view does not depend on the peer staying invited).
      final all = await (await ApiUser.phoneAccountForCleanup()).diaryEvents();
      final rows = all.where((r) => r['eventID'] == eventId).toList();
      expect(rows, hasLength(1), reason: 'the schedule still exists');
      expect(rows.first['title'], renamed, reason: 'the server keeps the new title');
      expect(rows.first['description'], '$renamed note', reason: 'and the new description');
      final storedStart = KDiaryApi.diaryTime(rows.first['scheduleStartDateAndTime']);
      expect(storedStart == null ? null : hhmm(storedStart), hhmm(start),
          reason: 'the start did not move');
      expect(KDiaryApi.participantsOf(rows.first), contains(Bench.peerId.toLowerCase()),
          reason: 'the invitee is kept');
      expect(all.where((r) => '${r['title']}'.contains(title)), hasLength(1),
          reason: 'the edit changed the schedule instead of adding another');
    } finally {
      await cleanup(title);
    }
  });

  patrolTest('choosing Delete in a schedule\'s Remarks takes it off the Today list',
      config: benchConfig, ($) async {
    final start = todayAt(const Duration(hours: 2));
    final end = start.add(const Duration(minutes: 30));
    if (!slotFitsToday(start, end)) {
      markTestSkipped('the slot now + 2 h must fall on today, after 07:00');
      return;
    }
    final title = unique('kdiary');
    try {
      final eventId = await (await ApiUser.phoneAccountForCleanup()).createOneTimeSchedule(
        title: title,
        description: '$title note',
        start: start,
        end: end,
        participants: [Bench.peerId],
      );
      await openKDiary($);
      expect(await listed($, title), isTrue,
          reason: 'the schedule is on the Today list; on screen: ${dumpScreen($, 'Today list')}');
      // The card's right side ("Remarks" + an edit icon while no remark is set).
      await card($, title).$('Remarks').first.tap();
      await $(KDiaryRemarksScreen).waitUntilVisible();
      await $(KDiaryRemarksScreen).$('Delete').tap();
      await $(KDiaryRemarksScreen)
          .$(TextField)
          .containing('Write Your Task Remarks')
          .enterText('QA bench: no longer needed');
      await $(KDiaryRemarksScreen).$(ElevatedButton).containing('Submit').tap();
      final gone = await unlisted($, title);
      final shown = dumpScreen($, 'after Remarks Delete');
      expect(gone, isTrue, reason: 'the deleted schedule leaves the Today list; on screen: $shown');
      final rows = await peerRows(eventId: eventId);
      expect(rows.isEmpty || rows.first['remarks'] == 6, isTrue,
          reason: 'the server deleted it or marks it Deleted (remarks 6); stored: $rows');
    } finally {
      await cleanup(title);
    }
  });

  patrolTest('deleting a schedule from the ⋮ menu removes it from the list and the server',
      config: benchConfig, ($) async {
    final start = todayAt(const Duration(hours: 2));
    final end = start.add(const Duration(minutes: 30));
    if (!slotFitsToday(start, end)) {
      markTestSkipped('the slot now + 2 h must fall on today, after 07:00');
      return;
    }
    final title = unique('kdiary');
    try {
      final eventId = await (await ApiUser.phoneAccountForCleanup()).createOneTimeSchedule(
        title: title,
        description: '$title note',
        start: start,
        end: end,
        participants: [Bench.peerId],
      );
      await openKDiary($);
      expect(await listed($, title), isTrue,
          reason: 'the schedule is on the Today list; on screen: ${dumpScreen($, 'Today list')}');
      await $(KDiaryTaskViewScreen).$(find.byIcon(KPOST.KP_31_More)).tap();
      await $(KDiaryShareBottomSheet).$('Delete').tap();
      await $.pump(const Duration(seconds: 1));
      // Delete turns the list into selection mode: a Checkbox on every card.
      await card($, title, holding: Checkbox).$(Checkbox).first.tap();
      await $.pump(const Duration(seconds: 1));
      final shown = dumpScreen($, 'selection mode');
      final deleteAction = $(KDiaryTaskViewScreen).$(find.byIcon(KPOST.KP_29_Delete));
      expect(deleteAction, findsWidgets,
          reason: 'with a schedule ticked, the screen offers a Delete action (the source has '
              'none: ⋮ › Delete only sets isSelectionMode, and nothing ever calls '
              'dairySchedule/deleteEvent); on screen: $shown');
      await deleteAction.first.tap();
      await $.pump(const Duration(seconds: 3));
      final gone = await unlisted($, title);
      expect(gone, isTrue,
          reason: 'the schedule leaves the list; on screen: ${dumpScreen($, 'after Delete')}');
      final rows = await peerRows(eventId: eventId);
      expect(rows.isEmpty || rows.first['remarks'] == 6, isTrue,
          reason: 'the server no longer keeps it; stored: $rows');
    } finally {
      await cleanup(title);
    }
  });

  patrolTest('a Daily repeated schedule is saved and kept by the server', config: benchConfig,
      ($) async {
    // The pickers' own times (now + 10 min, then + 40 min) must stay on today.
    if (DateTime.now().hour >= 22) {
      markTestSkipped('the default slot would cross midnight');
      return;
    }
    final title = unique('kdiary repeat');
    try {
      await openKDiary($);
      await openAddSchedule($);
      await fillRepeated($, title: title, description: '$title note');
      final form = repeatedForm($);
      expect(textOf($, form, 'From'), isNotEmpty, reason: 'From took the picker time');
      expect(textOf($, form, 'To'), isNotEmpty, reason: 'To took the picker time');
      final shown = await tapSave($, form, KdiaryRepeatedAddScheduleWidget);

      // The phone part is over (no participant, so only the owner can read it).
      final rows = await (await ApiUser.phoneAccountForCleanup()).diaryEventsMarked(title);
      expect(rows, hasLength(1), reason: 'the server keeps the repeated schedule once; after Save: $shown');
      expect(rows.first['title'], title);
      expect(rows.first['description'], '$title note');
      expect(rows.first['type'], 1, reason: 'Daily is stored as type 1 (onPressAddRepeatedSchedule)');
      expect(rows.first['priority'], 3, reason: 'High is stored as 3');
    } finally {
      await cleanup(title);
    }
  });
}
