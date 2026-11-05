import 'package:dio/dio.dart';
import 'package:kpost5_2023/app_common/constants/api_url_constants.dart';

import 'peer_api.dart';

/// One KMail API client per signed-in account (an extension cannot hold a field).
final _kmailClients = Expando<Dio>('kmail');

/// KMail over the KMail API (a different host from the KPost API: the app copy's own patched
/// `ApiUrlConstants.apiKmailBaseUrl`, the QA backend's :9081/v2/), with the KPost bearer token, as
/// the app sends it (base_api.dart getApiHeaders: Content-Type + Accept JSON, `Bearer <token>`).
///
/// Mails are only ever sent between the two QA accounts (qatest7, qatest8): never an external
/// address, so no real e-mail leaves the KPost domain. Every mail a test makes is deleted with
/// [deleteKmails] (each account deletes its own copy; deleteKmailWithDeletedBy only marks the
/// caller's side, CommonMailServiceImpl.deleteKmailWithDeletedBy).
extension KmailApi on ApiUser {
  Dio get kmail => _kmailClients[this] ??= Dio(BaseOptions(
        baseUrl: ApiUrlConstants.apiKmailBaseUrl,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
        connectTimeout: const Duration(seconds: 20),
        receiveTimeout: const Duration(seconds: 30),
        // Judged by the caller, so a refusal reads as a finding instead of an exception.
        validateStatus: (_) => true,
      ));

  /// Sends a New mail to [to] (a QA account only) with the body the app's compose screen sends
  /// (kpost_common PostMailRequestModel.toJson, built in kmail_write_controller_v1.dart
  /// _buildPostMailRequest: kmailType 0, salutation "Hi", no attachments), POST sentMail/postMail/.
  /// Returns the new kmailID and its transaction ids (what deleteKmailWithDeletedBy takes).
  Future<({int kmailId, List<int> transactionIds})> sendKmail({
    required String to,
    required String subject,
    required String body,
  }) async {
    if (!to.toLowerCase().endsWith('@kpostindia.com')) {
      throw StateError('KMail helpers send only to QA KPost accounts, not "$to"');
    }
    final response = await kmail.post<Object>('sentMail/postMail/', data: {
      'toAddress': to.toLowerCase(),
      'kmailSubject': subject,
      'referenceKmailID': null,
      'saluation': 'Hi',
      'saluationName': 'Qatest Bench',
      'kmailContent': '<p>$body</p>',
      'groupFlag': false,
      'groupReceiverList': null,
      'kmailSendDate': DateTime.now().millisecondsSinceEpoch,
      'senderLatitde': 13.0476875,
      'senderLongitude': 80.2655737,
      'kmailType': 0, // New
      'forwardList': null,
      'revealSource': null,
      'selectedMembers': 'N',
      'priority': 0,
      'attachmentFlag': 0,
      'originalKmailID': null,
      'forwardNote': null,
      'forwardAttachmentLists': null,
      'ccList': <String>[],
      'bccList': <String>[],
      'attachmentUuid': <String>[],
      'attachmentCaption': '[]',
    });
    final data = response.data is Map ? (response.data as Map)['data'] : null;
    final row = data is List && data.isNotEmpty && data.first is Map ? data.first as Map : null;
    final kmailId = row?['kmailID'];
    if (response.statusCode != 200 || kmailId is! int) {
      throw StateError('$kpostId could not send a KMail: HTTP ${response.statusCode} ${response.data}');
    }
    return (kmailId: kmailId, transactionIds: transactionIdsOf(row!.cast<String, dynamic>()));
  }

  /// The 1:1 mails between this account and [other], newest first, as the server returns them
  /// (POST common/selectedContactMails/ with the app's SelectedContactRequestMode body,
  /// fetchMailType 'A' = all). Deleted copies are included: their transaction says
  /// `deleteBySender` / `deleteByReceiver` = 'Y' (KmailTransaction.java).
  Future<List<Map<String, dynamic>>> kmailsWith(String other) async {
    final response = await kmail.post<Object>('common/selectedContactMails/', data: {
      'kpostUser': kpostId,
      'selectedContact': other,
      'fetchMailType': 'A',
      'groupFlag': false,
      'count': 50,
    });
    if (response.statusCode != 200) {
      throw StateError('the KMail thread did not read back: HTTP ${response.statusCode}');
    }
    final data = response.data is Map ? (response.data as Map)['data'] : null;
    return [
      for (final row in data is List ? data : const [])
        if (row is Map) row.cast<String, dynamic>(),
    ];
  }

  /// The kmailIDs of the 1:1 mails between this account and [other].
  Future<Set<int>> kmailIdsWith(String other) async => {
        for (final mail in await kmailsWith(other))
          if (mail['kmailID'] is int) mail['kmailID'] as int,
      };

  /// One mail's content as this account reads it (POST readMail/sentAndInboxMailContent/ with
  /// the app's KmailContentRequestModel: 'sent' or 'Received', the transaction's kmailNumber),
  /// returned as the raw response text, for a contains() check.
  Future<String> kmailContent(Map<String, dynamic> mail, String other) async {
    final txn = transactionsOf(mail).firstOrNull ?? const <String, dynamic>{};
    final sentByMe = '${txn['sender']}'.toLowerCase() == kpostId.toLowerCase();
    final response = await kmail.post<Object>('readMail/sentAndInboxMailContent/', data: {
      'kmailID': mail['kmailID'],
      'kmailType': sentByMe ? 'sent' : 'Received',
      'kmailNumber': txn['kmailNumber'] ?? 0,
      'selectedContact': other,
      'groupFlag': false,
    });
    return '${response.statusCode} ${response.data}';
  }

  /// Marks this account's copy of the given transactions deleted, with the body the app sends
  /// (kpost_common DeleteKMailRequestModel: groupFlag + transactionIDs), POST
  /// common/deleteKmailWithDeletedBy/. Returns the HTTP status.
  Future<int> deleteKmails(List<int> transactionIds) async {
    if (transactionIds.isEmpty) return 200;
    final response = await kmail.post<Object>(
      'common/deleteKmailWithDeletedBy/',
      data: {'groupFlag': false, 'transactionIDs': transactionIds},
    );
    return response.statusCode ?? 0;
  }

  /// Deletes this account's copy of every mail with [other] for which [which] holds (cleanup).
  Future<void> deleteKmailsWith(String other, bool Function(Map<String, dynamic> mail) which) async {
    final ids = <int>[
      for (final mail in await kmailsWith(other))
        if (which(mail)) ...transactionIdsOf(mail),
    ];
    await deleteKmails(ids);
  }

  /// Adds [contactId] to this account's address book, with the body the app sends
  /// (add_contact_request_model.dart), POST contacts/addContact on the KPost API. Removed again
  /// with ApiUser.deleteContact.
  Future<void> addContact(String contactId, {required String firstName, required String lastName}) async {
    final response = await dio.post<Object>('contacts/addContact', data: {
      'contactID': contactId,
      'firstName': firstName,
      'lastName': lastName,
      'userType': 'PERSONAL',
    });
    if (response.statusCode != 200) {
      throw StateError('$contactId was not added as a contact: HTTP ${response.statusCode}');
    }
  }

  /// A mail's transactions (one per recipient).
  static List<Map<String, dynamic>> transactionsOf(Map<String, dynamic> mail) {
    final list = mail['kmailTransactionList'];
    return [
      for (final t in list is List ? list : const [])
        if (t is Map) t.cast<String, dynamic>(),
    ];
  }

  static List<int> transactionIdsOf(Map<String, dynamic> mail) => [
        for (final t in transactionsOf(mail))
          if (t['transactionID'] is int) t['transactionID'] as int,
      ];

  /// True when [mail] was sent by [sender] (its transaction's sender).
  static bool sentBy(Map<String, dynamic> mail, String sender) => transactionsOf(mail)
      .any((t) => '${t['sender']}'.toLowerCase() == sender.toLowerCase());
}
