import 'peer_api.dart';

/// Address-book calls for setup, read-back and cleanup in the contacts tests, with the bodies the app
/// sends (lib/app_common/apis/contacts_api.dart and its request models). Removing a contact is
/// [ApiUser.deleteContact] (peer_api.dart): the server's delete clears the reference and the block too
/// (ContactsDirectoryDaoImpl.deleteContact sets referenceName = NULL, isBlocked = false).
extension ContactsApi on ApiUser {
  /// [contactId]'s row in this account's address book (contacts/myContacts/, `contacts_added[]`: contactID,
  /// referenceName, isBlocked, ...), or null when it is not a contact (or was deleted).
  Future<Map<String, dynamic>?> contactRow(String contactId) async {
    final response = await dio.post<Map<String, dynamic>>(
      'contacts/myContacts/',
      data: {'lastfetchDate': null},
    );
    if (response.statusCode != 200) {
      throw StateError('the address book did not read back: HTTP ${response.statusCode}');
    }
    final rows = response.data?['contacts_added'];
    for (final row in rows is List ? rows : const []) {
      if (row is Map &&
          row['deleteStatus'] != true &&
          '${row['contactID']}'.toLowerCase() == contactId.toLowerCase()) {
        return Map<String, dynamic>.from(row);
      }
    }
    return null;
  }

  /// Adds [contactId] as a KPOST contact the way the app does after "Add Contact"
  /// (ContactsBL.addContactDetails → AddContactRequestModel.toJson: the contact's id plus the SIGNED-IN
  /// user's own first and last name, userType PERSONAL; POST contacts/addContact).
  Future<void> addContact(String contactId) async {
    final me = await profile();
    final response = await dio.post<Map<String, dynamic>>('contacts/addContact', data: {
      'contactID': contactId,
      'firstName': _capitalizeFirst('${me['firstName'] ?? ''}'),
      'lastName': _capitalizeFirst('${me['lastName'] ?? ''}'),
      'userType': 'PERSONAL',
    });
    final code = response.data?['statusCode'] ?? response.statusCode;
    if (response.statusCode != 200 || code != 200) {
      throw StateError('$contactId was not added as a contact: HTTP ${response.statusCode} / $code');
    }
  }

  /// Sets the reference name this account keeps for [contactId] (ContactsBL.addReferenceBL →
  /// AddRefrenceRequestModel.toJson: contactID, the contact's first and last name, referenceName;
  /// POST contacts/addContactReference/).
  Future<void> setReference(String contactId, String referenceName,
      {required String firstName, required String lastName}) async {
    final response = await dio.post<Map<String, dynamic>>('contacts/addContactReference/', data: {
      'contactID': contactId,
      'firstName': firstName,
      'lastName': lastName,
      'referenceName': referenceName,
    });
    if (response.statusCode != 200) {
      throw StateError('the reference was not set: HTTP ${response.statusCode}');
    }
  }

  /// Blocks or unblocks [contactId] (ContactsAPI.blockOrUnBlockContact → BlockOrUnBlockContactRequest:
  /// {contactID, isBlocked}; POST contacts/blockOrUnBlockContact/). Used for setup and to put the block
  /// state back.
  Future<void> setBlocked(String contactId, bool blocked) async {
    final response = await dio.post<Map<String, dynamic>>(
      'contacts/blockOrUnBlockContact/',
      data: {'contactID': contactId, 'isBlocked': blocked},
    );
    if (response.statusCode != 200) {
      throw StateError('the block state was not set: HTTP ${response.statusCode}');
    }
  }

  static String _capitalizeFirst(String s) =>
      s.isEmpty ? s : s[0].toUpperCase() + s.substring(1).toLowerCase();
}
