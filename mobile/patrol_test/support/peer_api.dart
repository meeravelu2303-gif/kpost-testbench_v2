import 'dart:convert';
import 'dart:math';

import 'package:dio/dio.dart';

import 'bench.dart';

/// A QA account driven over the KPost API from inside a phone test. The second user (qatest8) sends
/// what the phone must receive and reads back what the phone sent; it is never signed in on the
/// phone, so its API session cannot sign the phone out. The phone's own account is signed in over
/// the API only at the very end of a test, to delete what the phone sent.
class ApiUser {
  ApiUser._(this._dio, this.kpostId);

  final Dio _dio;
  final String kpostId;

  /// The second user (qatest8).
  static Future<ApiUser> peer() => signIn(Bench.peerId, Bench.peerPassword);

  /// The phone's account (qatest7), for cleanup after the phone is done: this sign-in ends the
  /// phone's session.
  static Future<ApiUser> phoneAccountForCleanup() => signIn(Bench.kpostId, Bench.password);

  static Future<ApiUser> signIn(String kpostId, String password) async {
    if (kpostId.isEmpty || password.isEmpty || Bench.kpostApi.isEmpty) {
      throw StateError('Run through `npm run mobile:test`; the API accounts are not configured');
    }
    final dio = Dio(BaseOptions(
      baseUrl: Bench.kpostApi,
      headers: {'Content-Type': 'application/json'},
      connectTimeout: const Duration(seconds: 20),
      receiveTimeout: const Duration(seconds: 30),
      // Judged by the caller, so a refusal reads as a finding instead of an exception.
      validateStatus: (_) => true,
    ));
    final login = await dio.post<Map<String, dynamic>>('signupLogin/userLogin/', data: {
      'deviceType': 'Web',
      'deviceIdentity_primary': '9f9d6bd8-238f-11ed-b3e2-73ce62ed0e94',
      'deviceIdentity_secondary': 'Desktop-Chrome',
      'login_lattitude': 13.0476875,
      'login_longitude': 80.2655737,
      'oneSignal_Key': 'qa-bench',
      'voip': 'voip',
      'module': 0,
      'sessionID': _sessionId(),
      'kpostID': kpostId,
      'loginRO': {'countryID': '1', 'password': password, 'userType': 'PERSONAL'},
      'logintime': DateTime.now().millisecondsSinceEpoch,
    });
    final token = login.data?['accessToken'];
    if (login.statusCode != 200 || token is! String) {
      throw StateError('$kpostId could not sign in over the API: HTTP ${login.statusCode}');
    }
    dio.options.headers['Authorization'] = 'Bearer $token';
    return ApiUser._(dio, kpostId);
  }

  /// Sends a 1:1 Katchup message with the body the Flutter app itself sends
  /// (KatchupSendMessageRequestModel.toJson: Quill delta text, groupFlag a boolean; replayed live
  /// on the QA backend 2026-10-29) and returns its msgID.
  Future<int> sendKatchup({
    required String to,
    required String subject,
    required String text,
  }) async {
    final now = DateTime.now().toUtc().millisecondsSinceEpoch;
    final response = await _dio.post<Map<String, dynamic>>('katchup/sendMessage/', data: {
      'receiver': to,
      'messageType': 0, // normal message
      'subject': subject,
      'actualMessage': jsonEncode([
        {'insert': '$text\n'},
      ]),
      'messageTime': now,
      'serverTime': now,
      'status': 0, // sent
      'sessionID': 'android',
      'groupFlag': false,
      'forwardReceiverList': <Object>[],
      'groupForwardList': <Object>[],
      'groupmemberList': <Object>[],
      'referenceMessageIDList': <Object>[],
      'selectedMembers': 'N',
      'sharedMessageDetails': '',
      'secretMessageExpireTime': null,
      'isVanished': false,
      'sharedType': 0,
      'temporaryMsgID': 1,
      'isHtml': false,
      'referenceMessage': null,
      'attachmentCaption': 'null',
      'uuid': <Object>[],
      'isVoiceMessage': false,
      'contactDetails': null,
      'sharedDetailReceiverList': null,
    });
    final rows = response.data?['data'];
    final msgId = rows is List && rows.isNotEmpty ? (rows.first as Map)['msgID'] : null;
    if (response.statusCode != 200 || msgId is! int) {
      throw StateError('$kpostId could not send a message: HTTP ${response.statusCode}');
    }
    return msgId;
  }

  /// The messages of the 1:1 conversation with [other] (newest page), as the server returns them.
  Future<List<Map<String, dynamic>>> conversationWith(String other) async {
    final response = await _dio.post<Object>(
      'katchup/katchupMessagesForSelectedContactID/',
      data: {'groupFlag': false, 'firstMsgID': null, 'lastMsgID': null, 'receiver': other},
    );
    if (response.statusCode != 200) {
      throw StateError('the conversation did not read back: HTTP ${response.statusCode}');
    }
    final messages = <Map<String, dynamic>>[];
    void collect(Object? node) {
      if (node is Map) {
        if (node.containsKey('msgID') && node.containsKey('subject')) {
          messages.add(node.cast<String, dynamic>());
        }
        node.values.forEach(collect);
      } else if (node is List) {
        node.forEach(collect);
      }
    }

    collect(response.data);
    return messages;
  }

  /// Deletes messages this account sent (cleanup; failures are ignored).
  Future<void> deleteMessages(List<int> ids) async {
    if (ids.isEmpty) return;
    await _dio.post<Object>(
      'katchup/deleteKatchUpMessage/',
      data: {'messageIds': ids, 'groupFlag': false},
    );
  }

  static String _sessionId() {
    final random = Random.secure();
    return List.generate(16, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  }
}
