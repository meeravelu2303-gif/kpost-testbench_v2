import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:kpost5_2023/app_common/constants/api_url_constants.dart';

import 'peer_api.dart';

/// Settings over the API, for the phone tests in patrol_test/settings/: the original value read
/// before the phone signs in, the value read back after the phone part, and the original put back.
///
/// Endpoints (app copy: lib/app_common/constants/api_url_constants.dart, lib/settings/apis/profile_api.dart,
/// lib/kmail/apis/kmail_api.dart; backend: KPOST_V5.0 GeneralSettingController / UserProfileControllerV2,
/// Kpost_Kmail_5.0 KmailSettingController / CommonMailController):
/// - GET  generalSetting/getAllNotification                       -> data.{katchup,kmail,kall}Notification
/// - POST generalSetting/{katchup,kmail,kall}Notification          (NotificationRequestModel.toJson)
/// - GET  profile/getUserProfile/                                   -> userProfile.privacyDetails (JSON string)
/// - POST profile/updatePrivacySettingDetails                       (DigitalCardPrivacyRequestModel.toJson)
/// - GET  <KMail>common/getInstantReply/                            -> data[{id, instantReply, customized}]
/// - POST <KMail>kmailSetting/saveOrUpdateCustomizedInstantReply   ({instantReply})
/// - POST <KMail>kmailSetting/deleteCustomizedInstantReply         ({id})
extension SettingsApi on ApiUser {
  /// The three notification blocks the server keeps for this account ('katchup', 'kmail', 'kall'),
  /// each as a map (null when the server has none). The column is a JSON map; a JSON string is decoded.
  Future<Map<String, Map<String, dynamic>?>> notifications() async {
    final response = await dio.get<Object>('generalSetting/getAllNotification');
    final body = response.data;
    final data = body is Map ? body['data'] : null;
    return {
      for (final channel in const ['katchup', 'kmail', 'kall'])
        channel: settingsMap(data is Map ? data['${channel}Notification'] : null),
    };
  }

  /// Writes one channel's notification block ([channel] = 'katchup' | 'kmail' | 'kall') and returns the
  /// HTTP status. Used only to put the original back.
  ///
  /// The app sends `messagePreview` / `sound` / `vibrate` / `doNotDisturb` (NotificationRequestModel),
  /// while the backend copy reads and stores "Message Preview" / "Sound" / "Vibrate" / "Do Not Disturb"
  /// (GeneralSettingServiceImpl, KPA-495). The restore sends both spellings so it lands whichever one
  /// the QA server reads. An empty stored value ("" from that mismatch) is restored as the app's default,
  /// because the server refuses an empty "Do Not Disturb".
  Future<int?> restoreNotification(String channel, Map<String, dynamic>? original) async {
    Object? pick(String label, String camel, Object fallback) {
      final value = original?[label] ?? original?[camel];
      return (value == null || value == '') ? fallback : value;
    }

    final preview = pick('Message Preview', 'messagePreview', 1);
    final sound = pick('Sound', 'sound', 'Default');
    final vibrate = pick('Vibrate', 'vibrate', 1);
    final dnd = pick('Do Not Disturb', 'doNotDisturb', 0);
    final response = await dio.post<Object>('generalSetting/${channel}Notification', data: {
      'messagePreview': preview,
      'sound': sound,
      'vibrate': vibrate,
      'doNotDisturb': dnd,
      'Message Preview': preview,
      'Sound': sound,
      'Vibrate': vibrate,
      'Do Not Disturb': dnd,
    });
    return response.statusCode;
  }

  /// The Digital Card visibility map the server keeps (`mobile`, `about`, `school`, `college`,
  /// `university`, `experience`, `otherActivity`, each "true"/"false"), or null when none is stored.
  /// It is a JSON string column (UserProfile.privacyDetails), found wherever the profile returns it.
  Future<Map<String, dynamic>?> privacyDetails() async {
    final response = await dio.get<Object>('profile/getUserProfile/');
    final holders = ApiUser.findMaps(response.data, (m) => m.containsKey('privacyDetails'));
    for (final holder in holders) {
      final map = settingsMap(holder['privacyDetails']);
      if (map != null) return map;
    }
    return null;
  }

  /// Writes the Digital Card visibility map with the body the app and the web send (a flat map of
  /// "true"/"false" strings, DigitalCardPrivacyRequestModel.toJson / DigitalCardSettings.js) and returns
  /// the HTTP status. Used only to put the original back.
  Future<int?> setPrivacyDetails(Map<String, dynamic> values) async {
    final response = await dio.post<Object>(
      'profile/updatePrivacySettingDetails',
      data: {for (final e in values.entries) e.key: '${e.value}'},
    );
    return response.statusCode;
  }

  /// A client for the KMail API with this account's token (the app sends the same bearer token to
  /// both APIs). The URLs are the app copy's own, which the bench points at the QA KMail server.
  Dio _kmail() => Dio(BaseOptions(
        headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer $token'},
        connectTimeout: const Duration(seconds: 20),
        receiveTimeout: const Duration(seconds: 30),
        validateStatus: (_) => true,
      ));

  /// Every Instant Reply this account has (`id`, `instantReply`, `customized`), as getInstantReply
  /// returns them: the KMail defaults and the user's own (customized) ones.
  Future<List<Map<String, dynamic>>> instantReplies() async {
    final response = await _kmail().get<Object>(ApiUrlConstants.getInstantReply);
    final body = response.data;
    final data = body is Map ? body['data'] : null;
    if (response.statusCode != 200 || data is! List) {
      throw StateError('the Instant Replies did not read back: HTTP ${response.statusCode}');
    }
    return data.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  /// The ids of this account's own (customized) Instant Replies.
  Future<Set<String>> instantReplyIds() async => {
        for (final row in await instantReplies())
          if (row['customized'] == true) '${row['id']}',
      };

  /// Adds an Instant Reply with the body the app sends (kmail_api.dart saveOrUpdateCustomizedInstantReply,
  /// no id = a new one), so a phone test can start from a known row.
  Future<void> addInstantReply(String text) async {
    final response = await _kmail()
        .post<Object>(ApiUrlConstants.saveOrUpdateCustomizedInstantReply, data: {'instantReply': text});
    if (response.statusCode != 200) {
      throw StateError('the Instant Reply was not added: HTTP ${response.statusCode}');
    }
  }

  /// Deletes one of this account's Instant Replies (cleanup; the result is not checked).
  Future<void> deleteInstantReply(String id) async {
    await _kmail().post<Object>(ApiUrlConstants.deleteCustomizedInstantReply, data: {'id': id});
  }
}

/// [value] as a map: a map as is, a JSON object string decoded, anything else null.
Map<String, dynamic>? settingsMap(Object? value) {
  if (value is Map) return value.map((k, v) => MapEntry('$k', v));
  if (value is String && value.trim().startsWith('{')) {
    try {
      final decoded = jsonDecode(value);
      if (decoded is Map) return decoded.map((k, v) => MapEntry('$k', v));
    } on FormatException {
      return null;
    }
  }
  return null;
}

/// A stored on/off flag read under either spelling ([label] as the backend stores it, [camel] as the
/// app sends it): true for 1 / "1" / true / "true", false for 0 / "0" / false / "false", else null.
bool? settingsFlag(Map<String, dynamic>? block, String label, [String? camel]) {
  final value = block?[label] ?? (camel == null ? null : block?[camel]);
  if (value == 1 || value == '1' || value == true || value == 'true') return true;
  if (value == 0 || value == '0' || value == false || value == 'false') return false;
  return null;
}
