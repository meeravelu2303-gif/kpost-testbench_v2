import 'package:flutter/material.dart';
import 'package:flutter_list_view/flutter_list_view.dart';
import 'package:flutter_quill/flutter_quill.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:kpost5_2023/app_common/views/widgets/common_widgets/katchup_header_widget.dart';
import 'package:kpost5_2023/kmail/views/screens/write_mail/mail_editor_surface.dart';
import 'package:kpost5_2023/kmail/views/widgets/kmail_reply_type_editor.dart';
import 'package:kpost5_2023/kmail/views/widgets/reference_mail_list_tile_widget/receiver_ref_mail_tile_widget.dart';
import 'package:patrol/patrol.dart';

import './bench.dart';
import './kmail_api.dart';
import './peer_api.dart';

/// Shared steps of the KMail phone tests, mapped from the Test_ENV source:
/// - KMail is the first bottom-navigation item (base_controller.dart, label 'kmail'.tr = "KMail").
/// - The KMail dashboard (kmail_dashboard_screen.dart → kmail_list_widget.dart) lists mails as
///   "Subject : <subject>" (kmail_item.widget.dart; GetX capitalizeFirst lower-cases all but the
///   first letter) and has the compose FAB (tooltip 'compose_kmail'.tr = "Compose KMail").
/// - A row opens the thread with that contact (kmail_all_and_unopened_screen.dart), whose mails
///   read "Sub: <subject> " (kmail_tile_widget_v1.dart); a tap opens the mail
///   (kmail_mail_opend_tile.dart), where a received mail has the reply icon KPOST.KP_73_rply that
///   opens Reply / … / More → Delete (receiver_ref_mail_tile_widget.dart).
/// - Compose (write_kmail_screen.dart): the To field (hint 'to:_'.tr = "To: ", a TypeAhead over the
///   address book), Subject (hint 'subject:_'.tr = "Subject:"), the body editor (a QuillEditor in
///   MailEditorSurface) and the send button (icon KPOST.KP_3164).
/// - Refusals are snackbars (app_utils.dart showSnackBar, 2 s): 'please_fill_required_fields' =
///   "Please fill required fields", 'please_enter_valid_email' = "Please Enter Valid Email";
///   a delete says "Kmail Deleted Successfully" (kmail_message_bl.dart deleteKmails).
class KmailSteps {
  KmailSteps._();

  static const requiredFields = 'Please fill required fields';
  static const invalidEmail = 'Please Enter Valid Email';
  static const deleted = 'Kmail Deleted Successfully';

  /// Home → KMail dashboard.
  static Future<void> openKmail(PatrolIntegrationTester $) async {
    await $(BottomNavigationBar).$('KMail').tap();
    await $.pump(const Duration(seconds: 3));
  }

  /// Home → KMail → the compose FAB → the Write Mail screen.
  static Future<void> openCompose(PatrolIntegrationTester $) async {
    await openKmail($);
    await $(find.byTooltip('Compose KMail')).tap();
    await $(MailEditorSurface).waitUntilVisible();
    // The contacts behind the To suggestions load from the local DB when the screen opens.
    await $.pump(const Duration(seconds: 2));
  }

  /// Types the peer's KPost ID into To and picks the address-book suggestion, which is what fills
  /// the address the mail is sent to (write_kmail_screen.dart onSelected → toController; the field
  /// itself then shows the contact's name). The peer must be in the phone account's contacts.
  static Future<void> pickPeer(PatrolIntegrationTester $) async {
    await $(TextField).containing('To: ').enterText(Bench.peerId);
    final suggestion = $(KatchupMessageHeader);
    await suggestion.waitUntilVisible();
    await suggestion.tap();
    await $.pump(const Duration(seconds: 1));
  }

  /// Types into To and presses the keyboard's done action, without picking a suggestion.
  static Future<void> typeTo(PatrolIntegrationTester $, String address) async {
    await $(TextField).containing('To: ').enterText(address);
    await $.tester.testTextInput.receiveAction(TextInputAction.done);
    await $.pump(const Duration(milliseconds: 300));
  }

  static Future<void> typeSubject(PatrolIntegrationTester $, String subject) async {
    await $(TextField).containing('Subject:').enterText(subject);
  }

  /// The body is a Quill editor: focus it by a tap, then type through text input (as in
  /// katchup_test.dart).
  static Future<void> typeBody(PatrolIntegrationTester $, String text) async {
    await $.tester.tap(find.descendant(
      of: find.byType(MailEditorSurface),
      matching: find.byType(QuillEditor),
    ));
    await $.pump();
    $.tester.testTextInput.enterText(text);
    await $.pump(const Duration(milliseconds: 500));
  }

  /// Taps the compose screen's send button (icon KPOST.KP_3164).
  static Future<void> tapSend(PatrolIntegrationTester $) async {
    await $.tester.tap(find.byIcon(KPOST.KP_3164).last);
    await $.pump(const Duration(milliseconds: 300));
  }

  /// True when [text] shows on screen within [within] (a snackbar stays 2 s).
  static Future<bool> sees(
    PatrolIntegrationTester $,
    String text, {
    Duration within = const Duration(seconds: 5),
  }) async {
    final end = DateTime.now().add(within);
    while (DateTime.now().isBefore(end)) {
      if (find.textContaining(text).evaluate().isNotEmpty) return true;
      await $.pump(const Duration(milliseconds: 200));
    }
    return false;
  }

  /// A Text that contains [part], ignoring case (the dashboard re-cases the subject).
  static Finder textLike(String part) => find.byWidgetPredicate(
        (w) => w is Text && (w.data?.toLowerCase().contains(part.toLowerCase()) ?? false),
      );

  /// From Home: KMail → the dashboard row of the mail with [subject] → its thread → the mail
  /// opened. Pull-to-refresh is the fallback when the list has not loaded it yet.
  static Future<void> openReceivedMail(PatrolIntegrationTester $, String subject) async {
    await openKmail($);
    final row = $(textLike(subject));
    if (!await appears(row)) {
      final list = find.byType(FlutterListView);
      if (list.evaluate().isNotEmpty) {
        await $.tester.fling(list.first, const Offset(0, 500), 1500);
        await $.pump(const Duration(seconds: 3));
      }
    }
    await row.waitUntilVisible();
    await row.tap();
    // The thread opens the tapped mail by itself (kmail_message_controller.dart: the row's kmailID
    // is initialKmailID, added to openedKmails); tapping its tile then would close it again, so the
    // tile is tapped only when the mail did not open on its own.
    final replyIcon = $(find.byIcon(KPOST.KP_73_rply));
    if (!await appears(replyIcon)) {
      final tile = $('Sub: $subject ');
      await tile.waitUntilVisible();
      await tile.tap();
      await replyIcon.waitUntilVisible();
    }
  }

  /// In an opened received mail: the reply icon → Reply → the reply editor, typed and sent.
  static Future<void> reply(PatrolIntegrationTester $, String text) async {
    await $(find.byIcon(KPOST.KP_73_rply)).tap();
    await $(ReceiverRefMailTileWidget).$(ListTile).containing('Reply').tap();
    await $(ReplyTypeEditor).waitUntilVisible();
    await $.tester.tap(find.descendant(
      of: find.byType(ReplyTypeEditor),
      matching: find.byType(QuillEditor),
    ));
    await $.pump();
    $.tester.testTextInput.enterText(text);
    await $.pump(const Duration(milliseconds: 500));
    await $.tester.tap(find.descendant(
      of: find.byType(ReplyTypeEditor),
      matching: find.byIcon(KPOST.KP_3164),
    ));
    await $.pump(const Duration(seconds: 2));
  }

  /// In an opened received mail: the reply icon → More → Delete.
  static Future<void> deleteOpenedMail(PatrolIntegrationTester $) async {
    await $(find.byIcon(KPOST.KP_73_rply)).tap();
    await $(ReceiverRefMailTileWidget).$('More').tap();
    await $(ReceiverRefMailTileWidget).$(ListTile).containing('Delete').tap();
  }

  /// True when [finder] shows up within 10 seconds.
  static Future<bool> appears(PatrolFinder finder) async {
    try {
      await finder.waitUntilVisible(timeout: const Duration(seconds: 10));
      return true;
    } on WaitUntilVisibleTimeoutException {
      return false;
    }
  }

  /// Puts the peer in the phone account's address book (the To field suggests contacts only).
  /// Call before signInWithPassword. True when it was added (so it is removed afterwards).
  static Future<bool> ensurePeerContact() async {
    final phone = await ApiUser.phoneAccountForCleanup();
    if ((await phone.contactIds()).contains(Bench.peerId.toLowerCase())) return false;
    await phone.addContact(Bench.peerId, firstName: 'Qatest8', lastName: 'Bench');
    return true;
  }

  /// The peer's mail from the phone for which [which] holds, polled for up to 20 s.
  static Future<Map<String, dynamic>?> arrivedAtPeer(
    ApiUser peer,
    bool Function(Map<String, dynamic> mail) which,
  ) async {
    for (var i = 0; i < 10; i++) {
      final mails = await peer.kmailsWith(Bench.kpostId);
      final hit = mails
          .where((m) => KmailApi.sentBy(m, Bench.kpostId) && which(m))
          .firstOrNull;
      if (hit != null) return hit;
      await Future<void>.delayed(const Duration(seconds: 2));
    }
    return null;
  }

  static bool subjectIs(Map<String, dynamic> mail, String subject) =>
      '${mail['kmailSubject']}'.toLowerCase() == subject.toLowerCase();

  /// Cleanup, never thrown: the peer deletes its copies, then the phone's account (this sign-in
  /// ends the phone's session, so it runs last) deletes its copies and, when [removeContact],
  /// takes the peer out of its address book again.
  static Future<void> cleanUp(
    ApiUser peer,
    bool Function(Map<String, dynamic> mail) which, {
    bool removeContact = false,
    required String label,
  }) async {
    try {
      await peer.deleteKmailsWith(Bench.kpostId, which);
      final phone = await ApiUser.phoneAccountForCleanup();
      await phone.deleteKmailsWith(Bench.peerId, which);
      if (removeContact) await phone.deleteContact(Bench.peerId);
    } catch (error) {
      // ignore: avoid_print
      print('kmail cleanup failed (delete by hand: $label): $error');
    }
  }
}
