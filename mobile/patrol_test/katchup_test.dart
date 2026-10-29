import 'package:flutter/material.dart';
import 'package:flutter_list_view/flutter_list_view.dart';
import 'package:flutter_quill/flutter_quill.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:kpost5_2023/katchup/views/screens/katchup_screens/katchup_dashboard_screen.dart';
import 'package:kpost5_2023/katchup/views/widgets/quil_editor_wrapper.dart';
import 'package:patrol/patrol.dart';

import 'support/bench.dart';
import 'support/first_run.dart';
import 'support/peer_api.dart';

/// Katchup on the phone, with a real second user: qatest8 sends a message over the API, the phone
/// finds it by its Subject, opens the chat, and replies with its own Subject and text; the reply is
/// then read back on the server as qatest8. Both messages are deleted by their senders at the end.
///
/// The backend emits no socket event for an API-sent message (only a push), so the message is sent
/// before the phone opens Katchup, which loads the list from the server; pull-to-refresh is the
/// fallback when it is not there yet.
void main() {
  patrolTest('a message from another user arrives with its Subject, and the reply reaches them',
      config: benchConfig, ($) async {
    final run = DateTime.now().millisecondsSinceEpoch;
    final inSubject = 'QA phone in $run';
    final inText = 'QA bench message to the phone, safe to ignore ($run)';
    final outSubject = 'QA phone reply $run';
    final outText = 'QA bench reply from the phone ($run)';

    final peer = await ApiUser.peer();
    final inId = await peer.sendKatchup(to: Bench.kpostId, subject: inSubject, text: inText);
    try {
      await signInWithPassword($);

      // The conversation list, by its Subject line ("Subject : <subject>").
      await $(BottomNavigationBar).$('Katchup').tap();
      await $(KatchupDashboardScreen).waitUntilVisible();
      final row = $('Subject : $inSubject');
      if (!await _appears(row)) {
        await $.tester.fling(find.byType(FlutterListView).first, const Offset(0, 500), 1500);
        await $.pumpAndSettle();
      }
      await row.waitUntilVisible();
      expect(find.textContaining(inText), findsWidgets, reason: 'the list shows the message text');

      // Inside the chat the 1:1 Subject reads "Subject: <subject>", the body is rich text.
      await row.tap();
      await $('Subject: $inSubject').waitUntilVisible();
      expect(find.textContaining(inText, findRichText: true), findsWidgets,
          reason: 'the chat shows the message the other user sent');

      // Reply: the compose button shows the Subject field and the editor (Reply would hide the
      // Subject). The editor is a Quill editor: focus it by a tap, then type through text input.
      await $.tester.tap(find.byTooltip('Compose Message'));
      await $.pumpAndSettle();
      await $(TextFormField).containing('Subject').enterText(outSubject);
      await $.tester.tap(find.descendant(
        of: find.byType(QuillEditorWrapper),
        matching: find.byType(QuillEditor),
      ));
      await $.pump();
      await $.tester.testTextInput.enterText(outText);
      await $.pump();
      expect(find.textContaining(outText, findRichText: true), findsWidgets,
          reason: 'the reply text is in the editor');
      await $.tester.tap(find.byIcon(KPOST.KP_3164));
      await $.pumpAndSettle();
      expect($('Unblock'), findsNothing, reason: 'the two QA accounts must not block each other');

      await $('Subject: $outSubject').waitUntilVisible();

      // The server has it, from the phone's account, as the other user reads the conversation.
      Map<String, dynamic>? reply;
      for (var i = 0; i < 10 && reply == null; i++) {
        final messages = await peer.conversationWith(Bench.kpostId);
        reply = messages.where((m) => m['subject'] == outSubject).firstOrNull;
        if (reply == null) await Future<void>.delayed(const Duration(seconds: 2));
      }
      expect(reply, isNotNull, reason: 'the other user receives the reply');
      expect(reply?['sender'], Bench.kpostId, reason: 'sent by the phone\'s account');
      expect('${reply?['actualMessage']}', contains(outText), reason: 'with the typed text');
    } finally {
      // A cleanup failure is printed, never thrown: it must not hide the test's own result.
      try {
        await peer.deleteMessages([inId]);
        // The phone's own reply, deleted by its sender; this API sign-in ends the phone's session,
        // which is why it runs last.
        final mine = await ApiUser.phoneAccountForCleanup();
        final sent = await mine.conversationWith(Bench.peerId);
        await mine.deleteMessages([
          for (final m in sent)
            if (m['subject'] == outSubject && m['msgID'] is int) m['msgID'] as int,
        ]);
      } catch (error) {
        // ignore: avoid_print
        print('katchup_test cleanup failed (delete by hand: "$inSubject", "$outSubject"): $error');
      }
    }
  });
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
