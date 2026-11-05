import 'package:flutter_test/flutter_test.dart';
import 'package:patrol/patrol.dart';

import '../support/bench.dart';
import '../support/first_run.dart';
import '../support/kmail_api.dart';
import '../support/peer_api.dart';
import '../support/kmail_support.dart';

/// KMail on the phone with a real second user (qatest8, driven over the KMail API, never on the
/// phone): a mail composed on the phone reaches qatest8 with its subject and text; a mail from
/// qatest8 is opened on the phone and the reply reaches them; a received mail deleted on the phone
/// is gone from the phone's side only. Screens and steps: kmail_support.dart. Only the two QA
/// accounts are ever addressed (no external recipient), there are no attachments, and every mail
/// is deleted over the API afterwards by both accounts.
void main() {
  patrolTest('a mail composed on the phone reaches the other user with its subject and text',
      config: benchConfig, ($) async {
    final run = DateTime.now().millisecondsSinceEpoch;
    final subject = 'QA mail from phone $run';
    final body = 'QA bench mail from the phone, safe to ignore ($run)';
    final peer = await ApiUser.peer();
    final contactAdded = await KmailSteps.ensurePeerContact();
    try {
      await signInWithPassword($);
      await KmailSteps.openCompose($);
      await KmailSteps.pickPeer($);
      await KmailSteps.typeSubject($, subject);
      await KmailSteps.typeBody($, body);
      await KmailSteps.tapSend($);
      await $.pump(const Duration(seconds: 3));
      final shown = dumpScreen($, 'after Send');

      final mail = await KmailSteps.arrivedAtPeer(peer, (m) => KmailSteps.subjectIs(m, subject));
      expect(mail, isNotNull,
          reason: 'qatest8 receives the mail with the typed Subject; on screen: $shown');
      final txn = KmailApi.transactionsOf(mail!).first;
      expect('${txn['receiver']}'.toLowerCase(), Bench.peerId.toLowerCase(),
          reason: 'addressed to the picked contact');
      expect(await peer.kmailContent(mail, Bench.kpostId), contains('$run'),
          reason: 'the other user reads the typed text');
    } finally {
      await KmailSteps.cleanUp(peer, (m) => KmailSteps.subjectIs(m, subject),
          removeContact: contactAdded, label: '"$subject"');
    }
  });

  patrolTest('a mail addressed by typing the full KPost ID (no suggestion picked) is delivered',
      config: benchConfig, ($) async {
    final run = DateTime.now().millisecondsSinceEpoch;
    final subject = 'QA typed address $run';
    final body = 'QA bench mail to a typed address, safe to ignore ($run)';
    final peer = await ApiUser.peer();
    try {
      await signInWithPassword($);
      await KmailSteps.openCompose($);
      await KmailSteps.typeTo($, Bench.peerId);
      await $.pump(const Duration(seconds: 2));
      await KmailSteps.typeSubject($, subject);
      await KmailSteps.typeBody($, body);
      await KmailSteps.tapSend($);
      final refused = await KmailSteps.sees($, KmailSteps.requiredFields);
      await $.pump(const Duration(seconds: 3));
      final shown = dumpScreen($, 'after Send to a typed address');

      final mail = await KmailSteps.arrivedAtPeer(peer, (m) => KmailSteps.subjectIs(m, subject));
      expect(mail, isNotNull,
          reason: 'a valid KPost address typed into To is a recipient. In the source the To field '
              'writes only the display-name controller (write_kmail_screen.dart TypeAheadField '
              'controller: nameController); the address that is sent (toController) is filled only '
              'by picking a suggestion, so the app may refuse it as "Please fill required fields" '
              '(seen: $refused); on screen: $shown');
    } finally {
      await KmailSteps.cleanUp(peer, (m) => KmailSteps.subjectIs(m, subject),
          label: '"$subject"');
    }
  });

  patrolTest('a mail from another user opens on the phone, and the reply reaches them',
      config: benchConfig, ($) async {
    final run = DateTime.now().millisecondsSinceEpoch;
    final inSubject = 'QA mail to phone $run';
    final inBody = 'QA bench mail to the phone, safe to ignore ($run)';
    final outText = 'QA bench reply from the phone ($run)';
    final peer = await ApiUser.peer();
    final sent = await peer.sendKmail(to: Bench.kpostId, subject: inSubject, body: inBody);
    try {
      await signInWithPassword($);
      await KmailSteps.openReceivedMail($, inSubject);
      final opened = dumpScreen($, 'received mail opened');
      // The opened mail reads "Sub: <subject>" (kmail_mail_opend_tile.dart).
      expect(find.text('Sub: $inSubject'), findsWidgets,
          reason: 'the phone shows the mail the other user sent, opened; on screen: $opened');

      await KmailSteps.reply($, outText);
      await $.pump(const Duration(seconds: 3));
      final shown = dumpScreen($, 'after the reply was sent');

      // A reply keeps the original Subject (kmail_message_controller.dart postMailS3).
      final reply = await KmailSteps.arrivedAtPeer(
        peer,
        (m) => KmailSteps.subjectIs(m, inSubject) && m['kmailID'] != sent.kmailId,
      );
      expect(reply, isNotNull, reason: 'the other user receives the reply; on screen: $shown');
      expect(await peer.kmailContent(reply!, Bench.kpostId), contains('$run'),
          reason: 'with the typed reply text');
    } finally {
      await KmailSteps.cleanUp(peer, (m) => KmailSteps.subjectIs(m, inSubject),
          label: '"$inSubject" (mail + reply)');
    }
  });

  patrolTest('a received mail deleted on the phone is gone from the phone, not from the sender',
      config: benchConfig, ($) async {
    final run = DateTime.now().millisecondsSinceEpoch;
    final subject = 'QA mail to delete $run';
    final peer = await ApiUser.peer();
    final sent = await peer.sendKmail(
      to: Bench.kpostId,
      subject: subject,
      body: 'QA bench mail the phone deletes, safe to ignore ($run)',
    );
    try {
      await signInWithPassword($);
      await KmailSteps.openReceivedMail($, subject);
      await KmailSteps.deleteOpenedMail($);
      final confirmed = await KmailSteps.sees($, KmailSteps.deleted);
      await $.pump(const Duration(seconds: 2));
      final shown = dumpScreen($, 'after Delete');
      expect(confirmed, isTrue, reason: 'the app confirms the delete; on screen: $shown');

      // The phone is done: its account reads its own copy back (this sign-in ends its session).
      final phone = await ApiUser.phoneAccountForCleanup();
      final mine = (await phone.kmailsWith(Bench.peerId))
          .where((m) => m['kmailID'] == sent.kmailId)
          .firstOrNull;
      final myTxn = mine == null ? null : KmailApi.transactionsOf(mine).firstOrNull;
      expect(mine == null || '${myTxn?['deleteByReceiver']}' == 'Y', isTrue,
          reason: "the server marks the phone's copy deleted (deleteByReceiver = Y) or no longer "
              'lists it; read back: $mine');

      final theirs = (await peer.kmailsWith(Bench.kpostId))
          .where((m) => m['kmailID'] == sent.kmailId)
          .firstOrNull;
      expect(theirs, isNotNull, reason: "the sender still has the mail in its own thread");
      expect('${KmailApi.transactionsOf(theirs!).first['deleteBySender']}', isNot('Y'),
          reason: "deleting on the phone does not delete the sender's copy");
    } finally {
      await KmailSteps.cleanUp(peer, (m) => m['kmailID'] == sent.kmailId, label: '"$subject"');
    }
  });
}
