import 'package:flutter/material.dart';
import 'package:flutter_list_view/flutter_list_view.dart';
import 'package:flutter_quill/flutter_quill.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:kpost5_2023/katchup/views/screens/katchup_screens/katchup_dashboard_screen.dart';
import 'package:kpost5_2023/katchup/views/widgets/quil_editor_wrapper.dart';
import 'package:patrol/patrol.dart';

import '../../support/bench.dart';
import '../../support/first_run.dart';
import '../../support/katchup_api.dart';
import '../../support/peer_api.dart';

/// Katchup compose on the phone, beyond the smoke test (katchup_test.dart), always in the 1:1 chat
/// with the second user (qatest8). The chat is opened the way the smoke test does: qatest8 sends a
/// seed message over the API first, the phone finds it in Katchup by its Subject line and opens it.
///
/// Mapped from the Test_ENV source:
/// - compose: the "Compose Message" button (tooltip 'compose_message'.tr), the Subject field (hint
///   'Subject') and the Quill editor (QuillEditorWrapper), send = KPOST.KP_3164
///   (katchup_message_screen.dart);
/// - send rules (katchup_message_controller.dart onPostKatchupMessage / katchupPostMessageNew): an
///   empty editor returns without sending; an empty Subject is sent as 'General'
///   (AttachmentPostRequestModel subject). The owner's requirement (docs/modules/katchup-flow.md §3,
///   2026-09-25) is that a message with no Subject is accepted, so the app's default is correct;
/// - a sent message's menu opens from its KPOST.KP_72_bell icon (katchup_message_widget.dart) and
///   lists 'Edit' and, while the message is unread, 'Recall' (send_menu_item_popup.dart);
///   Edit sends a new message of messageType 6 with the same Subject, Recall turns the original into
///   messageType 7 (katchup/recallMessage/, KatchupRepository.recallKatchupMessage);
/// - read state: `status` 2 = read (katchup_bl.dart readStatus), set when the receiver's chat reports
///   it over the socket (readTimeUpdateToSocket).
///
/// Every message is deleted by its sender afterwards: qatest8's at once, the phone's own by the
/// phone's account at the very end (that API sign-in ends the phone's session).
void main() {
  String unique(String what) => 'QA $what ${DateTime.now().millisecondsSinceEpoch}';

  patrolTest('a message sent from the phone keeps its Subject and text on the server',
      config: benchConfig, ($) async {
    final seed = unique('phone seed');
    final subject = unique('phone subject');
    final text = 'QA bench message from the phone, safe to ignore (${DateTime.now().millisecondsSinceEpoch})';
    final peer = await ApiUser.peer();
    final seedId = await peer.sendKatchup(to: Bench.kpostId, subject: seed, text: 'QA bench seed');
    try {
      await signInWithPassword($);
      await _openChat($, seed);
      await _compose($, subject: subject, text: text);
      await _send($);
      await $('Subject: $subject').waitUntilVisible();
      final shown = dumpScreen($, 'after sending with a Subject');

      final sent = await peer.waitForMessage(Bench.kpostId, (m) => m['subject'] == subject);
      expect(sent, isNotNull, reason: 'the other user receives the message; on screen: $shown');
      expect(sent?['sender'], Bench.kpostId, reason: "sent by the phone's account");
      expect('${sent?['actualMessage']}', contains(text), reason: 'with the typed text');
      expect(sent?['messageType'], 0, reason: 'as a normal message');
    } finally {
      await _cleanUp(peer, [seedId], (m) => m['subject'] == subject);
    }
  });

  patrolTest('a message with no Subject is still sent, under the default Subject',
      config: benchConfig, ($) async {
    final seed = unique('phone seed');
    final text = 'QA bench message with no subject (${DateTime.now().millisecondsSinceEpoch})';
    final peer = await ApiUser.peer();
    final seedId = await peer.sendKatchup(to: Bench.kpostId, subject: seed, text: 'QA bench seed');
    try {
      await signInWithPassword($);
      await _openChat($, seed);
      await _compose($, text: text);
      await _send($);
      await $.pump(const Duration(seconds: 3));
      final shown = dumpScreen($, 'after sending with no Subject');

      final sent = await peer.waitForMessage(
          Bench.kpostId, (m) => '${m['actualMessage']}'.contains(text));
      expect(sent, isNotNull,
          reason: 'a message with no Subject is accepted (owner requirement 2026-09-25, '
              'docs/modules/katchup-flow.md §3); on screen: $shown');
      expect(['General', ''], contains(sent?['subject']),
          reason: "kept under the app's default Subject 'General' (or none)");
    } finally {
      await _cleanUp(peer, [seedId], (m) => '${m['actualMessage']}'.contains(text));
    }
  });

  patrolTest('a Subject with no message text is not sent', config: benchConfig, ($) async {
    final seed = unique('phone seed');
    final subject = unique('phone empty body');
    final peer = await ApiUser.peer();
    final seedId = await peer.sendKatchup(to: Bench.kpostId, subject: seed, text: 'QA bench seed');
    try {
      await signInWithPassword($);
      await _openChat($, seed);
      await _compose($, subject: subject);
      await _send($);
      await $.pump(const Duration(seconds: 5));
      final shown = dumpScreen($, 'after sending a Subject with no text');

      final sent = await peer.messagesWith(Bench.kpostId, (m) => m['subject'] == subject);
      expect(sent, isEmpty,
          reason: 'an empty message is not sent (onPostKatchupMessage returns on an empty editor); '
              'on screen: $shown');
    } finally {
      await _cleanUp(peer, [seedId], (m) => m['subject'] == subject);
    }
  });

  patrolTest('editing a sent message reaches the other user as an edit with the new text',
      config: benchConfig, ($) async {
    final seed = unique('phone seed');
    final subject = unique('phone edit');
    final run = DateTime.now().millisecondsSinceEpoch;
    final original = 'QA bench original text ($run)';
    final edited = 'QA bench edited words ($run)';
    final peer = await ApiUser.peer();
    final seedId = await peer.sendKatchup(to: Bench.kpostId, subject: seed, text: 'QA bench seed');
    try {
      await signInWithPassword($);
      await _openChat($, seed);
      await _compose($, subject: subject, text: original);
      await _send($);
      await $('Subject: $subject').waitUntilVisible();

      await _openMessageMenu($, subject);
      await $(ListTile).containing('Edit').tap();
      await $.pump(const Duration(seconds: 1));
      await _typeInEditor($, edited);
      expect(find.textContaining(edited, findRichText: true), findsWidgets,
          reason: 'the new text is in the editor');
      await _send($);
      await $.pump(const Duration(seconds: 3));
      final shown = dumpScreen($, 'after the edit');

      final edit = await peer.waitForMessage(Bench.kpostId,
          (m) => m['subject'] == subject && '${m['actualMessage']}'.contains(edited));
      expect(edit, isNotNull,
          reason: 'the other user receives the edited text under the same Subject; on screen: $shown');
      expect(edit?['messageType'], 6, reason: 'as an edit (messageType 6), not a new message');
      expect(edit?['sender'], Bench.kpostId, reason: "sent by the phone's account");
    } finally {
      await _cleanUp(peer, [seedId], (m) => m['subject'] == subject);
    }
  });

  patrolTest('a message recalled before it is read is recalled on the server',
      config: benchConfig, ($) async {
    final seed = unique('phone seed');
    final subject = unique('phone recall');
    final text = 'QA bench message to recall (${DateTime.now().millisecondsSinceEpoch})';
    final peer = await ApiUser.peer();
    final seedId = await peer.sendKatchup(to: Bench.kpostId, subject: seed, text: 'QA bench seed');
    try {
      await signInWithPassword($);
      await _openChat($, seed);
      await _compose($, subject: subject, text: text);
      await _send($);
      await $('Subject: $subject').waitUntilVisible();

      // Recall is offered only while the message is unread, so qatest8 does not read the
      // conversation until the recall is done.
      await _openMessageMenu($, subject);
      final menu = dumpScreen($, 'message menu');
      expect($(ListTile).containing('Recall'), findsOneWidget,
          reason: 'an unread message of the phone can be recalled; on screen: $menu');
      await $(ListTile).containing('Recall').tap();
      await $.pump(const Duration(seconds: 4));
      final shown = dumpScreen($, 'after Recall');

      final after = await peer.messagesWith(Bench.kpostId, (m) => m['subject'] == subject);
      expect(after.where((m) => m['messageType'] != 7), isEmpty,
          reason: 'the other user no longer gets the message as a normal one: it is recalled '
              '(messageType 7) or gone; on screen: $shown; server: $after');
    } finally {
      await _cleanUp(peer, [seedId], (m) => m['subject'] == subject);
    }
  });

  patrolTest('a message the phone opens is shown as read to its sender', config: benchConfig,
      ($) async {
    final seed = unique('phone read receipt');
    final peer = await ApiUser.peer();
    final seedId = await peer.sendKatchup(
        to: Bench.kpostId, subject: seed, text: 'QA bench message to be read by the phone');
    try {
      final before = await peer.messagesWith(Bench.kpostId, (m) => m['msgID'] == seedId);
      expect(before.firstOrNull?['status'], isNot(2),
          reason: 'not read before the phone opens it: ${before.firstOrNull}');

      await signInWithPassword($);
      await _openChat($, seed);
      await $.pump(const Duration(seconds: 3));
      final shown = dumpScreen($, 'chat open');

      var read = await peer.waitForMessage(
          Bench.kpostId, (m) => m['msgID'] == seedId && m['status'] == 2,
          timeout: const Duration(seconds: 15));
      if (read == null) {
        // The chat may report what was read when it closes: leave it and look again.
        await $.platform.android.pressBack();
        await $.pump(const Duration(seconds: 2));
        read = await peer.waitForMessage(
            Bench.kpostId, (m) => m['msgID'] == seedId && m['status'] == 2,
            timeout: const Duration(seconds: 15));
      }
      final last = await peer.messagesWith(Bench.kpostId, (m) => m['msgID'] == seedId);
      expect(read, isNotNull,
          reason: 'once the phone opened the message, its sender sees it as read (status 2); '
              'server: ${last.firstOrNull}; on screen: $shown');
    } finally {
      await _cleanUp(peer, [seedId], (_) => false);
    }
  });
}

/// Katchup › the conversation whose last message has [subject] (list line "Subject : <subject>"),
/// opened; pull-to-refresh when the list has not loaded it yet (as in katchup_test.dart).
Future<void> _openChat(PatrolIntegrationTester $, String subject) async {
  await $(BottomNavigationBar).$('Katchup').tap();
  await $(KatchupDashboardScreen).waitUntilVisible();
  final row = $('Subject : $subject');
  if (!await _appears(row)) {
    await $.tester.fling(find.byType(FlutterListView).first, const Offset(0, 500), 1500);
    await $.pumpAndSettle();
  }
  await row.waitUntilVisible();
  await row.tap();
  await $('Subject: $subject').waitUntilVisible();
}

/// Opens the composer ("Compose Message") and fills what is given: [subject] into the Subject field,
/// [text] into the Quill editor.
Future<void> _compose(PatrolIntegrationTester $, {String? subject, String? text}) async {
  await $.tester.tap(find.byTooltip('Compose Message'));
  await $.pumpAndSettle();
  if (subject != null) await $(TextFormField).containing('Subject').enterText(subject);
  if (text != null) await _typeInEditor($, text);
}

/// Focuses the Quill editor by a tap and types [text] through the text input (it replaces what the
/// editor holds).
Future<void> _typeInEditor(PatrolIntegrationTester $, String text) async {
  await $.tester.tap(find.descendant(
    of: find.byType(QuillEditorWrapper),
    matching: find.byType(QuillEditor),
  ));
  await $.pump();
  // enterText returns void on some Flutter versions and a Future on others; pump either way.
  $.tester.testTextInput.enterText(text);
  await $.pump();
}

Future<void> _send(PatrolIntegrationTester $) async {
  await $.tester.tap(find.byIcon(KPOST.KP_3164));
  await $.pumpAndSettle();
  expect($('Unblock'), findsNothing, reason: 'the two QA accounts must not block each other');
}

/// Opens the menu of the phone's own message with [subject]: the KP_72_bell icon of that bubble.
/// The bubbles have no widget of their own, so the bell nearest (vertically) to the Subject line is
/// taken.
Future<void> _openMessageMenu(PatrolIntegrationTester $, String subject) async {
  final anchor = $.tester.getCenter(find.text('Subject: $subject').last);
  final bells = find.byIcon(KPOST.KP_72_bell);
  final count = bells.evaluate().length;
  expect(count, greaterThan(0), reason: 'the sent message shows its menu icon');
  var best = 0;
  var bestDistance = double.infinity;
  for (var i = 0; i < count; i++) {
    final distance = ($.tester.getCenter(bells.at(i)).dy - anchor.dy).abs();
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  await $.tester.tap(bells.at(best));
  await $.pumpAndSettle();
}

/// Deletes qatest8's [peerIds], then (as the phone's account, which ends the phone's session) every
/// message the phone sent to qatest8 that [phoneSent] matches.
Future<void> _cleanUp(
  ApiUser peer,
  List<int> peerIds,
  bool Function(Map<String, dynamic> message) phoneSent,
) async {
  try {
    await peer.deleteMessages(peerIds);
    final mine = await ApiUser.phoneAccountForCleanup();
    await mine.deleteSentTo(Bench.peerId, phoneSent);
  } catch (error) {
    // ignore: avoid_print
    print('katchup_compose_test cleanup failed (delete by hand: messages $peerIds): $error');
  }
}

/// True when [finder] shows up within 10 seconds.
Future<bool> _appears(PatrolFinder finder) async {
  try {
    await finder.waitUntilVisible(timeout: const Duration(seconds: 10));
    return true;
  } on WaitUntilVisibleTimeoutException {
    return false;
  }
}
