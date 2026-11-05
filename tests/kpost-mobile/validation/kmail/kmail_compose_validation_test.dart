import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/kmail/views/screens/write_mail/mail_editor_surface.dart';
import 'package:patrol/patrol.dart';

import '../../support/bench.dart';
import '../../support/first_run.dart';
import '../../support/kmail_api.dart';
import '../../support/peer_api.dart';
import '../../support/kmail_support.dart';

/// Compose refusals on the phone (write_kmail_screen.dart, kmail_write_controller_v1.dart): a mail
/// with no recipient, with an address that is not an e-mail, or with no Subject is not sent and
/// the user is told why. The app's rules: the send button calls postMailFromComposeV2 only when
/// To, Subject and body are all filled (_validateForm → isFormValid), otherwise it shows "Please
/// fill required fields"; isKmailFormValidation also requires a Subject ("Please Enter Subject");
/// the To field refuses a non-e-mail on submit ("Please Enter Valid Email") and clears it.
///
/// Whether anything left the phone is checked on qatest8's side over the KMail API (safe while the
/// phone is signed in): its thread with the phone must hold no new mail from the phone. Anything
/// that did get sent is deleted by both accounts afterwards. The invalid address has no '@', so
/// even a send could not reach a real mailbox.
void main() {
  /// The mails from the phone in qatest8's thread that were not there before.
  Future<List<Map<String, dynamic>>> newFromPhone(ApiUser peer, Set<int> before) async {
    await Future<void>.delayed(const Duration(seconds: 5));
    return (await peer.kmailsWith(Bench.kpostId))
        .where((m) => KmailApi.sentBy(m, Bench.kpostId) && !before.contains(m['kmailID']))
        .toList();
  }

  bool composeStillOpen() => find.byType(MailEditorSurface).evaluate().isNotEmpty;

  patrolTest('a mail with no recipient is not sent, and the user is told why',
      config: benchConfig, ($) async {
    final run = DateTime.now().millisecondsSinceEpoch;
    final subject = 'QA no recipient $run';
    final peer = await ApiUser.peer();
    final before = await peer.kmailIdsWith(Bench.kpostId);
    try {
      await signInWithPassword($);
      await KmailSteps.openCompose($);
      await KmailSteps.typeSubject($, subject);
      await KmailSteps.typeBody($, 'QA bench mail with no recipient ($run)');
      await KmailSteps.tapSend($);
      final told = await KmailSteps.sees($, KmailSteps.requiredFields);
      final shown = dumpScreen($, 'Send with no recipient');
      expect(told, isTrue, reason: 'the app says "${KmailSteps.requiredFields}"; on screen: $shown');
      expect(composeStillOpen(), isTrue, reason: 'the draft stays open to be completed');
      expect(await newFromPhone(peer, before), isEmpty, reason: 'nothing is sent');
    } finally {
      await KmailSteps.cleanUp(peer, (m) => !before.contains(m['kmailID']),
          label: 'new mails since the test started ("$subject")');
    }
  });

  patrolTest('an address that is not an e-mail is refused and nothing is sent',
      config: benchConfig, ($) async {
    final run = DateTime.now().millisecondsSinceEpoch;
    final subject = 'QA invalid address $run';
    final peer = await ApiUser.peer();
    final before = await peer.kmailIdsWith(Bench.kpostId);
    try {
      await signInWithPassword($);
      await KmailSteps.openCompose($);
      // No '@': not an e-mail address, and not routable anywhere.
      await KmailSteps.typeTo($, 'qatest8.kpostindia.com');
      final refusedAddress = await KmailSteps.sees($, KmailSteps.invalidEmail);
      final afterTo = dumpScreen($, 'invalid To submitted');
      expect(refusedAddress, isTrue,
          reason: 'the app says "${KmailSteps.invalidEmail}"; on screen: $afterTo');
      expect($(TextField).containing('To: ').exists, isTrue,
          reason: 'the invalid address is cleared from To (its hint shows again)');

      await KmailSteps.typeSubject($, subject);
      await KmailSteps.typeBody($, 'QA bench mail to an invalid address ($run)');
      await KmailSteps.tapSend($);
      final told = await KmailSteps.sees($, KmailSteps.requiredFields);
      final shown = dumpScreen($, 'Send after an invalid address');
      expect(told, isTrue, reason: 'Send is refused with no valid recipient; on screen: $shown');
      expect(composeStillOpen(), isTrue, reason: 'the draft stays open');
      expect(await newFromPhone(peer, before), isEmpty, reason: 'nothing is sent');
    } finally {
      await KmailSteps.cleanUp(peer, (m) => !before.contains(m['kmailID']),
          label: 'new mails since the test started ("$subject")');
    }
  });

  patrolTest('a mail with no Subject is not sent, and the user is told why',
      config: benchConfig, ($) async {
    final run = DateTime.now().millisecondsSinceEpoch;
    final peer = await ApiUser.peer();
    final before = await peer.kmailIdsWith(Bench.kpostId);
    final contactAdded = await KmailSteps.ensurePeerContact();
    try {
      await signInWithPassword($);
      await KmailSteps.openCompose($);
      await KmailSteps.pickPeer($);
      await KmailSteps.typeBody($, 'QA bench mail with no subject ($run)');
      await KmailSteps.tapSend($);
      final told = await KmailSteps.sees($, KmailSteps.requiredFields);
      final shown = dumpScreen($, 'Send with no Subject');
      expect(told, isTrue,
          reason: 'the Subject is required (isFormValid / isKmailFormValidation), so the app says '
              '"${KmailSteps.requiredFields}"; on screen: $shown');
      expect(composeStillOpen(), isTrue, reason: 'the draft stays open');
      expect(await newFromPhone(peer, before), isEmpty, reason: 'nothing is sent without a Subject');
    } finally {
      await KmailSteps.cleanUp(peer, (m) => !before.contains(m['kmailID']),
          removeContact: contactAdded, label: 'new mails since the test started (no subject, $run)');
    }
  });
}
