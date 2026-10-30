import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/views/screens/home_dashboard_screens/home_dashboard_screen.dart';
import 'package:patrol/patrol.dart';

import '../support/bench.dart';
import '../support/first_run.dart';

/// Signup & Login on the phone: a fresh install signs in as qatest7 with KPost ID + password and
/// reaches Home. The flow has no widget keys, so it is driven by the English texts the app shows.
void main() {
  patrolTest('a personal user signs in with KPost ID and password and reaches Home',
      config: benchConfig, ($) async {
    await signInWithPassword($);

    expect($(HomeDashboardScreen), findsOneWidget, reason: 'the home dashboard is open');
    expect($('Recents'), findsWidgets, reason: 'and shows the Recents tab');
    expect($('Katchup'), findsWidgets, reason: 'and the Katchup bottom tab');
  });
}
