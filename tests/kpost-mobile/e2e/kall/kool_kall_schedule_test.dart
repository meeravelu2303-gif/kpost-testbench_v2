import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/views/widgets/button/kpost_button.dart';
import 'package:patrol/patrol.dart';

import '../../support/bench.dart';
import '../../support/first_run.dart';
import '../../support/kall_api.dart';
import '../../support/peer_api.dart';
import '../../support/kool_kall_form.dart';

/// Kall › Kool Kall on the phone, for a later day: schedule a meeting with the second user, edit it
/// (which the app sends as a reschedule), and cancel it, each checked from the second user's side over
/// the API (kall/kallDashboard/).
///
/// Screens and rules (Test_ENV source): koolkall/views/koolkallView.dart + kool_controller.dart (the
/// form, OnPressedSubmit: a new meeting → kall/scheduledKall, an edited one → kall/reScheduleKall);
/// kall_dashboard_screen.dart (Kool Kall tab: one TodaysKoolKallCellWidget per meeting, tap → details);
/// koolkall/views/kooldetailsView.dart + kooldetails_ctrl.dart (the organiser's 'Cancel Kall' /
/// 'Edit Kall' before the start; Cancel asks 'Do you want to Cancel this Scheduled Kool Kall ?' →
/// 'Yes, Cancel' → kall/updateKallStatus with kallStatus 2). Server: KallControllerV3 /
/// KallServiceImplV3.reschedulekall (a reschedule saves a NEW kall at status 6 and moves the original
/// to 7, ReScheduled). Every meeting a test makes is ended over the API afterwards (kall/endKoolKall).
void main() {
  String unique(String what) => 'QA kall $what ${DateTime.now().millisecondsSinceEpoch}';

  DateTime today() {
    final now = DateTime.now();
    return DateTime(now.year, now.month, now.day);
  }

  DateTime inDays(int days) {
    final t = today();
    return DateTime(t.year, t.month, t.day + days);
  }

  bool nearMidnight() => DateTime.now().hour >= 23;

  Map<String, dynamic>? byId(List<Map<String, dynamic>> rows, int? id) {
    for (final row in rows) {
      if (row['kallID'] == id) return row;
    }
    return null;
  }

  bool invites(Map<String, dynamic> row, String kpostId) => ApiUser.findMaps(
        row['kallDetails'],
        (m) => '${m['receiver']}'.toLowerCase() == kpostId.toLowerCase(),
      ).isNotEmpty;

  patrolTest('a Kool Kall scheduled for tomorrow reaches the invited user with its title and times',
      config: benchConfig, ($) async {
    if (nearMidnight()) {
      markTestSkipped('"tomorrow" would change during the test');
      return;
    }
    final title = unique('tomorrow');
    final tomorrow = inDays(1);
    try {
      await signInWithPassword($);
      final result = await createKoolKall($, title: title, day: tomorrow);
      expect(result.created, isTrue,
          reason: "'Kool Kall created' shows after Create; on screen: ${result.shown}");

      final card = await koolKallCard($, title);
      final listed = dumpScreen($, 'Kool Kall tab after create');
      expect(card, findsOneWidget, reason: 'the meeting is listed on the Kool Kall tab; on screen: $listed');

      final rows = await (await ApiUser.peer()).koolKallsTitled(title);
      expect(rows, hasLength(1), reason: "the meeting is on the invited user's Kall list once");
      final row = rows.first;
      expect(row['senderKallStatus'], KoolKallStatus.scheduled, reason: 'it is Scheduled (6)');
      expect('${row['sender']}'.toLowerCase(), Bench.kpostId.toLowerCase(),
          reason: "the phone's account is the organiser");
      expect(invites(row, Bench.peerId), isTrue, reason: 'the second user is an invitee: $row');
      expect(kallTime(row['scheduledStartTime'])?.millisecondsSinceEpoch, slot(tomorrow, 10),
          reason: 'it starts tomorrow 00:10, the time the phone picked '
              '(server value: ${row['scheduledStartTime']})');
      expect(kallTime(row['scheduledEndTime'])?.millisecondsSinceEpoch, slot(tomorrow, 40),
          reason: 'it ends tomorrow 00:40 (server value: ${row['scheduledEndTime']})');
    } finally {
      await endKoolKallsTitled([title]);
    }
  });

  patrolTest('editing a Kool Kall reschedules it: new title and day, a new kall, the old one ReScheduled',
      config: benchConfig, ($) async {
    if (nearMidnight()) {
      markTestSkipped('"tomorrow" would change during the test');
      return;
    }
    final title = unique('to edit');
    final renamed = '$title moved';
    final tomorrow = inDays(1);
    final dayAfter = inDays(2);
    try {
      await signInWithPassword($);
      final result = await createKoolKall($, title: title, day: tomorrow);
      expect(result.created, isTrue,
          reason: "the meeting to edit is created; on screen: ${result.shown}");
      final peer = await ApiUser.peer();
      final originalRows = await peer.koolKallsTitled(title);
      expect(originalRows, hasLength(1), reason: 'the invited user sees the meeting before the edit');
      final originalId = originalRows.first['kallID'] as int?;

      await (await koolKallCard($, title)).tap();
      await $('Edit Kall').waitUntilVisible();
      await $('Edit Kall').tap();
      await $(KPOSTButton).containing('Reschedule Kall').waitUntilExists();
      // KoolController.onInit fills the form only after loading the contacts (async).
      for (var i = 0; i < 20 && fieldText($, 'Enter meeting name').isEmpty; i++) {
        await $.pump(const Duration(milliseconds: 500));
      }
      dumpScreen($, 'Reschedule Kall form');
      expect(fieldText($, 'Enter meeting name'), title,
          reason: 'the edit form opens with the meeting title filled in');
      expect(fieldText($, 'DD/MM/YYYY'), ymd(tomorrow), reason: 'and its date');

      await titleField($).enterText(renamed);
      await openDatePicker($);
      await pickDay($, dayAfter, shownMonth: tomorrow);
      expect(fieldText($, 'DD/MM/YYYY'), ymd(dayAfter), reason: 'the new day is taken');
      await submit($, 'Reschedule Kall');
      final rescheduled = await snackShown($, 'Kool Kall rescheduled');
      final shown = dumpScreen($, 'after Reschedule Kall');
      expect(rescheduled, isTrue, reason: "'Kool Kall rescheduled' shows; on screen: $shown");

      final rows = await peer.kallRows();
      final moved = rows.where((r) => r['subject'] == renamed).toList();
      expect(moved, hasLength(1),
          reason: 'the invited user sees the meeting under its new title once; on screen: $shown');
      final newRow = moved.first;
      expect(newRow['kallID'], isNot(originalId),
          reason: 'a reschedule creates a new kall with its own id (BR-C01)');
      expect(newRow['senderKallStatus'], KoolKallStatus.scheduled, reason: 'the new kall is Scheduled (6)');
      expect(invites(newRow, Bench.peerId), isTrue, reason: 'the second user is still invited: $newRow');
      expect(kallTime(newRow['scheduledStartTime'])?.millisecondsSinceEpoch, slot(dayAfter, 10),
          reason: 'it now starts the day after tomorrow at the same 00:10 '
              '(server value: ${newRow['scheduledStartTime']})');
      expect(kallTime(newRow['scheduledEndTime'])?.millisecondsSinceEpoch, slot(dayAfter, 40),
          reason: 'and ends at 00:40 that day (server value: ${newRow['scheduledEndTime']})');
      final original = byId(rows, originalId);
      expect(original?['senderKallStatus'], KoolKallStatus.rescheduled,
          reason: 'the original kall $originalId is marked ReScheduled (7): $original');
    } finally {
      await endKoolKallsTitled([title, renamed]);
    }
  });

  patrolTest('the organiser cancels a Kool Kall from its details and the invited user sees it cancelled',
      config: benchConfig, ($) async {
    if (nearMidnight()) {
      markTestSkipped('"tomorrow" would change during the test');
      return;
    }
    final title = unique('to cancel');
    final tomorrow = inDays(1);
    try {
      await signInWithPassword($);
      final result = await createKoolKall($, title: title, day: tomorrow);
      expect(result.created, isTrue,
          reason: "the meeting to cancel is created; on screen: ${result.shown}");

      await (await koolKallCard($, title)).tap();
      await $('Cancel Kall').waitUntilVisible();
      await $('Cancel Kall').tap();
      await $('Do you want to Cancel this Scheduled Kool Kall ?').waitUntilVisible();
      await $('Yes, Cancel').tap();
      final cancelled = await snackShown($, 'Kall cancelled');
      final shown = dumpScreen($, 'after Yes, Cancel');
      expect(cancelled, isTrue, reason: "'Kall cancelled' shows; on screen: $shown");

      final rows = await (await ApiUser.peer()).koolKallsTitled(title);
      expect(rows, hasLength(1), reason: 'the invited user still has the meeting on the list');
      expect(rows.first['senderKallStatus'], KoolKallStatus.cancelled,
          reason: 'the invited user sees it cancelled (2): ${rows.first}');
    } finally {
      await endKoolKallsTitled([title]);
    }
  });
}
