import 'dart:math';

import 'peer_api.dart';

/// KDiary over the KPost API (KPOST_V5.0 KdiaryScheduleController, `dairySchedule/*`), for the phone
/// tests' setup, read-back and cleanup. Bodies are the app's own (lib/KDiary/models/api_models/
/// request_model/*.dart toJson, built in kdiary_controller.dart onPressAddSchedule).
///
/// Who may read what (KdiaryScheduleRepository): `getEvents` returns every event the caller owns OR
/// is a participant of, so the peer (qatest8), invited on a schedule, reads it back at any time
/// without touching the phone's session. `deleteEvent` works only for the owner (the phone account).
extension KDiaryApi on ApiUser {
  /// Every diary event this account owns or is invited to (GET dairySchedule/getEvents; `data` list).
  /// The rows carry eventID, title, description, priority, type, schedule start/end, isKoolKall,
  /// snoozeDetails, remarks, createdBy and participants, but not kallID (KdiaryScheduleServiceImpl
  /// .getEvents copies the fields one by one and leaves it out).
  Future<List<Map<String, dynamic>>> diaryEvents() async {
    final response = await dio.get<Object>('dairySchedule/getEvents');
    if (response.statusCode != 200) {
      throw StateError('dairySchedule/getEvents answered HTTP ${response.statusCode}');
    }
    return ApiUser.findMaps(response.data, (m) => m.containsKey('eventID') && m.containsKey('title'));
  }

  /// The diary events whose title or description contains [marker].
  Future<List<Map<String, dynamic>>> diaryEventsMarked(String marker) async => [
        for (final row in await diaryEvents())
          if ('${row['title'] ?? ''}'.contains(marker) ||
              '${row['description'] ?? ''}'.contains(marker))
            row,
      ];

  /// The full event rows (kallID included) scheduled between the start of [from]'s day and the end of
  /// [to]'s day, as the app's This Week view asks for them (POST dairySchedule/getEventSelectedDate/,
  /// KDiarySelectedDateRequestModel; the server widens each date to its whole day).
  Future<List<Map<String, dynamic>>> diaryEventsBetween(DateTime from, DateTime to) async {
    final response = await dio.post<Object>('dairySchedule/getEventSelectedDate/', data: {
      'scheduleStartDateAndTime': DateTime(from.year, from.month, from.day).toUtc().toIso8601String(),
      'scheduleEndDateAndTime':
          DateTime(to.year, to.month, to.day, 23, 59).toUtc().toIso8601String(),
    });
    if (response.statusCode != 200) {
      throw StateError('dairySchedule/getEventSelectedDate answered HTTP ${response.statusCode}');
    }
    return ApiUser.findMaps(response.data, (m) => m.containsKey('eventID') && m.containsKey('title'));
  }

  /// Creates a one-time schedule with the body the app's One Time tab sends
  /// (KDiaryCreateScheduleRequestModel via onPressAddSchedule: the app always sends a reminder, at
  /// least one participant and Kool Kall on, because its Save refuses anything else). With
  /// [koolKall] and participants the server also schedules a Kool Kall (KdiaryScheduleServiceImpl
  /// .createSchedule), which [removeDiaryItems] ends. POST dairySchedule/createSchedule/; the
  /// response has no eventID, so it is looked up by title and returned.
  Future<int> createOneTimeSchedule({
    required String title,
    required String description,
    required DateTime start,
    required DateTime end,
    int priority = 3,
    List<String> participants = const [],
    bool reminder = true,
    bool koolKall = true,
  }) async {
    final response = await dio.post<Object>('dairySchedule/createSchedule/', data: {
      'kallSession': '$kpostId${start.millisecondsSinceEpoch}',
      'kallMode': 0,
      'meetingLink': 'KoolKall_${_uuidHead()}',
      'description': description,
      'title': title,
      'priority': priority,
      'scheduleStartDateAndTime': start.toUtc().toIso8601String(),
      'scheduleEndDateAndTime': end.toUtc().toIso8601String(),
      'isReminder': reminder,
      'isKoolKall': koolKall,
      'snoozeDetails': reminder ? 'Before 10 Minutes' : '',
      'participants': [
        for (final p in participants) {'participant': p, 'userType': 'Personal'},
      ],
    });
    if (response.statusCode != 200) {
      throw StateError('the schedule was not created: HTTP ${response.statusCode}');
    }
    final rows = (await diaryEvents()).where((r) => r['title'] == title).toList();
    final id = rows.isEmpty ? null : rows.first['eventID'];
    if (id is! int) throw StateError('the created schedule "$title" is not in getEvents');
    return id;
  }

  /// Deletes one of this account's events (POST dairySchedule/deleteEvent {eventID}; owner only;
  /// the app itself never calls it). Returns the HTTP status.
  Future<int?> deleteDiaryEvent(int eventId) async {
    final response = await dio.post<Object>('dairySchedule/deleteEvent', data: {'eventID': eventId});
    return response.statusCode;
  }

  /// Cleanup, as the owner (the phone account): ends the Kool Kall of every event marked with
  /// [marker] (found by kallID from [diaryEventsBetween], and by subject among today's Kool Kalls),
  /// then deletes the events. Never throws; a failure is printed.
  Future<void> removeDiaryItems(String marker) async {
    try {
      final now = DateTime.now();
      final kallIds = <int>{};
      for (final row in await diaryEventsBetween(
          now.subtract(const Duration(days: 1)), now.add(const Duration(days: 2)))) {
        final text = '${row['title'] ?? ''} ${row['description'] ?? ''}';
        final kallId = row['kallID'];
        if (text.contains(marker) && kallId is int && kallId > 0) kallIds.add(kallId);
      }
      final rows = await diaryEventsMarked(marker);
      for (final row in rows) {
        final title = '${row['title'] ?? ''}';
        if (title.isNotEmpty) kallIds.addAll(await todaysKoolKalls(title));
      }
      for (final id in kallIds) {
        await endKoolKall(id);
      }
      for (final row in rows) {
        final id = row['eventID'];
        if (id is int && '${row['createdBy']}'.toLowerCase() == kpostId.toLowerCase()) {
          final status = await deleteDiaryEvent(id);
          if (status != 200) {
            // ignore: avoid_print
            print('BENCH-CLEANUP: diary event $id was not deleted (HTTP $status)');
          }
        }
      }
    } catch (e) {
      // ignore: avoid_print
      print('BENCH-CLEANUP: KDiary cleanup for "$marker" failed: $e');
    }
  }

  /// A diary date as the app reads it (kdiary_task_view_screen.dart getTimeHHmm:
  /// DateTime.parse(...).toLocal()); epoch milliseconds are accepted too. Null when absent.
  static DateTime? diaryTime(Object? value) {
    if (value is int) return DateTime.fromMillisecondsSinceEpoch(value);
    if (value is String && value.isNotEmpty) return DateTime.tryParse(value)?.toLocal();
    return null;
  }

  /// The KPost IDs invited on an event row (lower case).
  static Set<String> participantsOf(Map<String, dynamic> row) => {
        for (final p in ApiUser.findMaps(row['participants'], (m) => m.containsKey('participant')))
          '${p['participant']}'.toLowerCase(),
      };

  /// The first 7 characters of a v4 UUID, as the app's meeting link uses (`KoolKall_xxxxxxx`).
  static String _uuidHead() {
    final random = Random.secure();
    return List.generate(4, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'))
        .join()
        .substring(0, 7);
  }
}
