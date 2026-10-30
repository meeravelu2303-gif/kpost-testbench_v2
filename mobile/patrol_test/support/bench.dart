import 'package:patrol/patrol.dart';

/// Finder waits for every bench test: a cold start (Firebase, the country list) and the QA backend
/// take longer than Patrol's defaults.
const benchConfig = PatrolTesterConfig(
  existsTimeout: Duration(seconds: 30),
  visibleTimeout: Duration(seconds: 30),
  // Every tap and wait in the run's output, so a failure shows the step it stopped at.
  printLogs: true,
);

/// What the bench passes into a phone run (scripts/mobile/run.mjs, through --dart-define-from-file).
/// Empty values mean the test was started some other way: it then stops with a clear message
/// instead of signing in as someone it should not.
class Bench {
  Bench._();

  /// The phone's account (qatest7): no Playwright run signs in as it.
  static const kpostId = String.fromEnvironment('BENCH_KPOST_ID');
  static const password = String.fromEnvironment('BENCH_PASSWORD');

  /// The app's access code for [kpostId]: created on the first sign-in, entered on every later one.
  static const accessCode = String.fromEnvironment('BENCH_ACCESS_CODE');

  /// The second user in chats and calls (qatest8), driven over the API, never on the phone.
  static const peerId = String.fromEnvironment('BENCH_PEER_ID');
  static const peerPassword = String.fromEnvironment('BENCH_PEER_PASSWORD');

  /// The QA backend's KPost API, as the app copy calls it (ends in /v2/).
  static const kpostApi = String.fromEnvironment('BENCH_KPOST_API');

  static void requireConfig() {
    final missing = {
      'BENCH_KPOST_ID': kpostId,
      'BENCH_PASSWORD': password,
      'BENCH_ACCESS_CODE': accessCode,
      'BENCH_KPOST_API': kpostApi,
    }.entries.where((e) => e.value.isEmpty).map((e) => e.key);
    if (missing.isNotEmpty) {
      throw StateError('Run through `npm run mobile:test`; missing ${missing.join(', ')}');
    }
  }
}
