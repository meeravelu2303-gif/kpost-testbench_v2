import 'package:flutter_test/flutter_test.dart';
import 'package:patrol/patrol.dart';

import '../support/bench.dart';
import '../support/first_run.dart';
import '../support/kall_api.dart';
import '../support/peer_api.dart';
import '../support/kool_kall_form.dart';

/// Kall › Kool Kall › Create on the phone: a form that is not complete or not sensible must not make a
/// meeting. The rules are the app's own (koolkall/controller/kool_controller.dart):
/// - OnPressedSubmit refuses a blank or spaces-only title ('Please provide Meeting Title') and a form
///   with no participant ('Please select participants');
/// - toTimePicker refuses a To time before From, or before now today ('correct_time'.tr = 'Please
///   select correct time') and leaves To empty;
/// - datePicker offers no day before today (showDatePicker firstDate = today).
/// The valid form is accepted in kool_kall_schedule_test.dart. Each test also checks over the API that
/// no meeting from the phone's account reached the second user, and ends any that did.
void main() {
  bool nearMidnight() {
    final hour = DateTime.now().hour;
    return hour < 1 || hour >= 23;
  }

  Future<Set<int>> peerSees() async => (await ApiUser.peer()).koolKallIdsFrom(Bench.kpostId);

  Future<Set<int>> addedSince(Set<int> before) async => (await peerSees()).difference(before);

  patrolTest('a Kool Kall with a blank title is not created', config: benchConfig, ($) async {
    if (nearMidnight()) {
      markTestSkipped("the default From/To slot (now + 10 / + 50 min) would cross midnight");
      return;
    }
    final before = await peerSees();
    try {
      await signInWithPassword($);
      await openCreateForm($);
      await titleField($).enterText('   ');
      await openFromPicker($);
      await $('OK').tap(); // now + 10 min
      await openToPicker($);
      await $('OK').tap(); // From + 40 min
      await inviteSecondUser($);
      await submit($, 'Create Kool Kall');
      final refused = await snackShown($, 'Please provide Meeting Title');
      final shown = dumpScreen($, 'after Create with a blank title');
      expect(refused, isTrue, reason: "'Please provide Meeting Title' shows; on screen: $shown");
      expect($('Create Schedule Kall'), findsOneWidget, reason: 'the form stays open; on screen: $shown');
      expect(await addedSince(before), isEmpty, reason: 'no meeting reaches the invited user');
    } finally {
      await endKoolKallsSince(before);
    }
  });

  patrolTest('a To time before the From time is refused and no Kool Kall is created',
      config: benchConfig, ($) async {
    if (nearMidnight()) {
      markTestSkipped('From (now + 10 min) and a To 30 minutes earlier must fall on the same day');
      return;
    }
    final before = await peerSees();
    try {
      await signInWithPassword($);
      await openCreateForm($);
      await titleField($).enterText('QA kall backwards ${DateTime.now().millisecondsSinceEpoch}');
      await openFromPicker($);
      await $('OK').tap(); // From = now + 10 min
      final from = fieldText($, 'From');
      await openToPicker($);
      await typeTime($, DateTime.now().subtract(const Duration(minutes: 20)));
      final refused = await snackShown($, 'Please select correct time');
      final shown = dumpScreen($, 'after a To before From');
      expect(refused, isTrue, reason: "'Please select correct time' shows (From $from); on screen: $shown");
      expect(fieldText($, 'To'), isEmpty, reason: 'the To field takes no time before From; on screen: $shown');

      await inviteSecondUser($);
      await submit($, 'Create Kool Kall');
      await $.pump(const Duration(seconds: 2));
      final after = dumpScreen($, 'after Create with no valid To');
      expect($('Create Schedule Kall'), findsOneWidget, reason: 'the form stays open; on screen: $after');
      expect(await addedSince(before), isEmpty, reason: 'no meeting reaches the invited user');
    } finally {
      await endKoolKallsSince(before);
    }
  });

  patrolTest('a day or a time already past cannot be chosen', config: benchConfig, ($) async {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    await signInWithPassword($);
    await openCreateForm($);
    expect(fieldText($, 'DD/MM/YYYY'), ymd(today), reason: 'the form opens on today');

    if (today.day > 1) {
      // Yesterday is in the calendar's month only after the 1st; it is shown but disabled.
      await openDatePicker($);
      await pickDay($, today.subtract(const Duration(days: 1)), shownMonth: today);
      final shown = dumpScreen($, 'after picking yesterday');
      expect(fieldText($, 'DD/MM/YYYY'), ymd(today),
          reason: 'yesterday cannot be picked, the date stays today; on screen: $shown');
    }

    if (now.hour >= 1) {
      // With no From yet, the To picker still refuses a time before now on today's date.
      await openToPicker($);
      await typeTime($, DateTime.now().subtract(const Duration(minutes: 30)));
      final refused = await snackShown($, 'Please select correct time');
      final shown = dumpScreen($, 'after a To in the past');
      expect(refused, isTrue, reason: "'Please select correct time' shows; on screen: $shown");
      expect(fieldText($, 'To'), isEmpty, reason: 'a past To time is not taken; on screen: $shown');
    }
  });

  patrolTest('a Kool Kall with no participant is not created', config: benchConfig, ($) async {
    if (nearMidnight()) {
      markTestSkipped("the default From/To slot (now + 10 / + 50 min) would cross midnight");
      return;
    }
    final before = await peerSees();
    try {
      await signInWithPassword($);
      await openCreateForm($);
      await titleField($).enterText('QA kall alone ${DateTime.now().millisecondsSinceEpoch}');
      await openFromPicker($);
      await $('OK').tap();
      await openToPicker($);
      await $('OK').tap();
      expect(find.textContaining('Please select invites'), findsOneWidget,
          reason: 'the form says no one is invited yet');
      await submit($, 'Create Kool Kall');
      final refused = await snackShown($, 'Please select participants');
      final shown = dumpScreen($, 'after Create with no participant');
      expect(refused, isTrue, reason: "'Please select participants' shows; on screen: $shown");
      expect($('Create Schedule Kall'), findsOneWidget, reason: 'the form stays open; on screen: $shown');
      expect(await addedSince(before), isEmpty,
          reason: 'no meeting is created (a meeting with no one invited would not reach the second '
              'user either, so this also relies on the form staying open)');
    } finally {
      await endKoolKallsSince(before);
    }
  });
}
