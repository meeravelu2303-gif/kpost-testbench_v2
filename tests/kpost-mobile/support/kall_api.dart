import 'peer_api.dart';

/// Kool Kall (scheduled call) statuses, as the app reads `senderKallStatus`
/// (koolkall/views/widget/todays_koolkall_list_widget.dart).
class KoolKallStatus {
  KoolKallStatus._();
  static const cancelled = 2;
  static const scheduled = 6;
  static const rescheduled = 7;
  static const closed = 8;
}

/// Kall reads and clean-up over the KPost API, for the phone's Kall tests (kall/*_test.dart).
extension KallApi on ApiUser {
  /// This account's newest calls and Kool Kalls, as the Kall screen loads them:
  /// POST kall/kallDashboard/ with `{'kallID': ''}` (kall/apis/all_kool_kall_api.dart). The server
  /// (KallControllerV3.kallDashboard → KallDaoImplV3.getUserActivitiesForKall) answers the rows
  /// under `kall`: calls this account organised or is invited to, newest kallID first.
  Future<List<Map<String, dynamic>>> kallRows() async {
    final response = await dio.post<Object>('kall/kallDashboard/', data: {'kallID': ''});
    if (response.statusCode != 200) {
      throw StateError('kall/kallDashboard/ did not answer: HTTP ${response.statusCode}');
    }
    final data = response.data;
    final rows = data is Map ? data['kall'] : null;
    return [
      for (final row in rows is List ? rows : const [])
        if (row is Map) row.map((k, v) => MapEntry('$k', v)),
    ];
  }

  /// The Kool Kalls on this account's Kall screen whose title is [subject].
  Future<List<Map<String, dynamic>>> koolKallsTitled(String subject) async =>
      (await kallRows()).where((row) => row['subject'] == subject).toList();

  /// The kallIDs of the Kool Kalls [organiser] scheduled that this account can see.
  Future<Set<int>> koolKallIdsFrom(String organiser) async => {
        for (final row in await kallRows())
          if ('${row['sender']}'.toLowerCase() == organiser.toLowerCase() && row['kallID'] is int)
            row['kallID'] as int,
      };

  /// Deletes the Katchup notices the server sent [other] about the Kool Kall titled [subject]
  /// (KallServiceImplV3.reschedulekall / scheduleKall send one per invitee; the text carries
  /// "Kall Subject : <subject>", KpostWelcomeMailAndMessage.scheduleKallkatchupInfo). Clean-up only:
  /// failures are ignored.
  Future<void> deleteKallNotices(String other, String subject) async {
    try {
      final ids = [
        for (final m in await conversationWith(other))
          if (m['msgID'] is int &&
              (m['sender'] == null || '${m['sender']}'.toLowerCase() == kpostId.toLowerCase()) &&
              '${m['actualMessage']}'.contains(subject))
            m['msgID'] as int,
      ];
      await deleteMessages(ids);
    } catch (e) {
      // ignore: avoid_print
      print('BENCH-CLEANUP kall notices for "$subject": $e');
    }
  }
}

/// A Kool Kall time as the server returns it (scheduledStartTime / scheduledEndTime), as an instant.
/// The app reads these strings as UTC wall-clock and adds 5:30 for IST
/// (todays_koolkall_list_widget.dart), so a string without a zone is read as UTC here; a number is
/// epoch milliseconds. Null when the value cannot be read.
DateTime? kallTime(Object? value) {
  if (value is int) return DateTime.fromMillisecondsSinceEpoch(value);
  if (value is! String || value.trim().isEmpty) return null;
  final text = value.trim();
  final hasZone = RegExp(r'(Z|[+-]\d\d:?\d\d)$').hasMatch(text);
  return DateTime.tryParse(hasZone ? text : '${text}Z');
}
