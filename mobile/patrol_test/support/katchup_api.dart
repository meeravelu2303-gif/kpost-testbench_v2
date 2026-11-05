import 'peer_api.dart';

/// Katchup read-back and cleanup over the KPost API, on top of ApiUser.conversationWith
/// (katchup/katchupMessagesForSelectedContactID/) and ApiUser.deleteMessages
/// (katchup/deleteKatchUpMessage/).
///
/// Server fields read here (KatchupMessages.java): `sender`, `subject`, `actualMessage` (the Quill
/// delta the app sent), `messageType` (0 normal, 6 edit, 7 recalled: katchup_message_controller.dart
/// msgType switch; KatchupRepository.recallKatchupMessage sets 7) and `status` (0 sent, 1 delivered /
/// unread, 2 read, 3 not reached: katchup_bl.dart readStatus).
extension KatchupApi on ApiUser {
  /// The messages of the 1:1 conversation with [other] for which [test] holds.
  Future<List<Map<String, dynamic>>> messagesWith(
    String other,
    bool Function(Map<String, dynamic> message) test,
  ) async =>
      (await conversationWith(other)).where(test).toList();

  /// Polls the conversation with [other] for up to [timeout] until [test] finds a message.
  Future<Map<String, dynamic>?> waitForMessage(
    String other,
    bool Function(Map<String, dynamic> message) test, {
    Duration timeout = const Duration(seconds: 20),
  }) async {
    final end = DateTime.now().add(timeout);
    while (true) {
      final found = (await messagesWith(other, test)).firstOrNull;
      if (found != null || DateTime.now().isAfter(end)) return found;
      await Future<void>.delayed(const Duration(seconds: 2));
    }
  }

  /// Deletes every message this account sent to [other] for which [test] holds (cleanup; a failure
  /// is printed, never thrown).
  Future<void> deleteSentTo(String other, bool Function(Map<String, dynamic> message) test) async {
    try {
      final mine = await messagesWith(
        other,
        (m) => '${m['sender']}'.toLowerCase() == kpostId.toLowerCase() && test(m),
      );
      await deleteMessages([
        for (final m in mine)
          if (m['msgID'] is int) m['msgID'] as int,
      ]);
    } catch (error) {
      // ignore: avoid_print
      print('katchup cleanup as $kpostId failed: $error');
    }
  }
}
