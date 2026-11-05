import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/KDiary/views/widgets/kdiary_add_schedule_widget.dart';
import 'package:kpost5_2023/KDiary/views/widgets/kdiary_repeated_add_schedule_widget.dart';
import 'package:patrol/patrol.dart';

import '../support/bench.dart';
import '../support/first_run.dart';
import '../support/kdiary_api.dart';
import '../support/peer_api.dart';
import '../support/kdiary_steps.dart';

/// KDiary › Add Schedule refuses what makes no sense: no title, a start in the past or at the current
/// minute, an end before the start (One Time: kdiary_add_schedule_widget.dart Save checks and
/// kdiary_controller.dart oneTimeFromTimePicker / oneTimeToTimePicker), and a Repeated schedule with
/// no title (kdiary_repeated_add_schedule_widget.dart, whose Save checks nothing). The valid case is
/// kdiary_schedule_test.dart's create tests.
///
/// Each test marks its schedule's description with a unique text and asks the server whether
/// anything with it was stored: a One Time attempt always invites the peer, so the peer reads it any
/// time; a Repeated one is read as the phone's account once the phone part is done. Whatever was
/// stored after all is deleted over the API.
void main() {
  Future<void> cleanup(String marker) async {
    try {
      await (await ApiUser.phoneAccountForCleanup()).removeDiaryItems(marker);
    } catch (e) {
      // ignore: avoid_print
      print('BENCH-CLEANUP: $e');
    }
  }

  Future<List<Map<String, dynamic>>> storedForPeer(String marker) async =>
      (await ApiUser.peer()).diaryEventsMarked(marker);

  patrolTest('a one-time schedule with no title is not saved', config: benchConfig, ($) async {
    final start = todayAt(const Duration(minutes: 90));
    if (!slotFitsToday(start, start.add(const Duration(minutes: 30)))) {
      markTestSkipped('the slot now + 90 min must fall on today, after 07:00');
      return;
    }
    final marker = unique('kdiary untitled');
    try {
      await openKDiary($);
      await openAddSchedule($);
      await fillOneTime($, description: '$marker note', from: start);
      final shown = await tapSave($, oneTimeForm($), KdiaryAddScheduleWidget);
      expect(oneTimeForm($), findsOneWidget,
          reason: 'Save is refused and the form stays open ("Please Enter Valid Title/Subject"); '
              'on screen: $shown');
      expect(await storedForPeer(marker), isEmpty, reason: 'nothing is stored without a title');
    } finally {
      await cleanup(marker);
    }
  });

  patrolTest('a one-time schedule whose title is only spaces is not saved', config: benchConfig,
      ($) async {
    final start = todayAt(const Duration(minutes: 90));
    if (!slotFitsToday(start, start.add(const Duration(minutes: 30)))) {
      markTestSkipped('the slot now + 90 min must fall on today, after 07:00');
      return;
    }
    final marker = unique('kdiary spaces');
    try {
      await openKDiary($);
      await openAddSchedule($);
      await fillOneTime($, title: '   ', description: '$marker note', from: start);
      final shown = await tapSave($, oneTimeForm($), KdiaryAddScheduleWidget);
      expect(oneTimeForm($), findsOneWidget,
          reason: 'Save is refused (the title is trimmed) and the form stays open; on screen: $shown');
      expect(await storedForPeer(marker), isEmpty, reason: 'nothing is stored with a blank title');
    } finally {
      await cleanup(marker);
    }
  });

  patrolTest('a one-time schedule starting in the past is not saved', config: benchConfig,
      ($) async {
    final now = DateTime.now();
    final past = todayAt(const Duration(minutes: -60));
    if (now.hour < 8 || past.day != now.day) {
      markTestSkipped('an hour ago must still be today, after 07:00');
      return;
    }
    final marker = unique('kdiary past');
    try {
      await openKDiary($);
      await openAddSchedule($);
      // The To picker does not open while From is empty, so To is left alone.
      await fillOneTime($, title: marker, description: '$marker note', from: past, setTo: false);
      final fromText = textOf($, oneTimeForm($), 'From');
      final picked = dumpScreen($, 'after the past From');
      expect(fromText, isNot(hhmm(past)),
          reason: 'From does not take a time an hour ago ("Please select correct time"); '
              'on screen: $picked');
      final shown = await tapSave($, oneTimeForm($), KdiaryAddScheduleWidget);
      expect(oneTimeForm($), findsOneWidget,
          reason: 'Save is refused and the form stays open; on screen: $shown');
      expect(await storedForPeer(marker), isEmpty, reason: 'nothing is stored for a past start');
    } finally {
      await cleanup(marker);
    }
  });

  patrolTest('a one-time schedule starting at the current minute is not saved',
      config: benchConfig, ($) async {
    final now = DateTime.now();
    // From = the picker's own start (now), To = From + 30 min: both must stay on today.
    if (!slotFitsToday(now, now.add(const Duration(minutes: 35)))) {
      markTestSkipped('the slot now + 30 min must fall on today, after 07:00');
      return;
    }
    final marker = unique('kdiary now');
    try {
      await openKDiary($);
      await openAddSchedule($);
      await fillOneTime($, title: marker, description: '$marker note', fromNow: true);
      final shown = await tapSave($, oneTimeForm($), KdiaryAddScheduleWidget);
      expect(oneTimeForm($), findsOneWidget,
          reason: 'Save is refused ("Schedule Time Must be Later than the Current Time.") and the '
              'form stays open; on screen: $shown');
      expect(await storedForPeer(marker), isEmpty,
          reason: 'nothing is stored for a schedule that starts now');
    } finally {
      await cleanup(marker);
    }
  });

  patrolTest('a one-time schedule that ends before it starts is not saved', config: benchConfig,
      ($) async {
    final start = todayAt(const Duration(hours: 2));
    final end = start.subtract(const Duration(hours: 1));
    if (!slotFitsToday(start, start)) {
      markTestSkipped('the slot now + 2 h must fall on today, after 07:00');
      return;
    }
    final marker = unique('kdiary backwards');
    try {
      await openKDiary($);
      await openAddSchedule($);
      await fillOneTime($, title: marker, description: '$marker note', from: start, to: end);
      final toText = textOf($, oneTimeForm($), 'To');
      final picked = dumpScreen($, 'after the early To');
      expect(toText, isNot(hhmm(end)),
          reason: 'To does not take a time before From ("Please select correct time"); '
              'on screen: $picked');
      final shown = await tapSave($, oneTimeForm($), KdiaryAddScheduleWidget);
      expect(oneTimeForm($), findsOneWidget,
          reason: 'Save is refused and the form stays open; on screen: $shown');
      final stored = await storedForPeer(marker);
      expect(stored, isEmpty, reason: 'nothing is stored that ends before it starts; stored: $stored');
    } finally {
      await cleanup(marker);
    }
  });

  patrolTest('a repeated schedule with no title is not saved', config: benchConfig, ($) async {
    if (DateTime.now().hour >= 22) {
      markTestSkipped('the default slot would cross midnight');
      return;
    }
    final marker = unique('kdiary repeat untitled');
    try {
      await openKDiary($);
      await openAddSchedule($);
      await fillRepeated($, description: '$marker note');
      final shown = await tapSave($, repeatedForm($), KdiaryRepeatedAddScheduleWidget);
      // The phone part is over: no participant, so only the owner can read it.
      final stored = await (await ApiUser.phoneAccountForCleanup()).diaryEventsMarked(marker);
      expect(stored, isEmpty,
          reason: 'a Repeated schedule with no title is refused (its Save checks nothing, unlike '
              "One Time's, and the server stores what it gets); after Save: $shown; stored: $stored");
    } finally {
      await cleanup(marker);
    }
  });
}
