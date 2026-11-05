import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/kall/views/screens/kall_screens/kall_list_widget.dart';
import 'package:kpost5_2023/koolkall/views/widget/todays_koolkall_list_widget.dart';
import 'package:patrol/patrol.dart';

import '../support/bench.dart';
import '../support/first_run.dart';
import '../support/kall_api.dart';
import '../support/peer_api.dart';

/// Kall screen on the phone, read only (nothing is tapped that could place a call): the bottom bar's
/// Kall opens kall_dashboard_screen.dart with the tabs 'Recents', 'Contacts', 'Kool Kall'
/// (kall_search_widget.dart). Recents is KallListWidget (kall_list_widget.dart: 'no_kalls'.tr = 'No Kalls
/// Found' when empty) and Kool Kall lists TodaysKoolKallCellWidget cards ('No Kool Kalls Found' when
/// empty). Both are filled from kall/kallDashboard/ (kall_bl.dart kallDashboardDetails,
/// all_kool_kall_api.dart), so what the phone shows is compared with what the server returns for the
/// phone's account, read after the phone part.
void main() {
  patrolTest('the Kall screen shows the same calls and Kool Kalls the server has for the account',
      config: benchConfig, ($) async {
    await signInWithPassword($);
    await $(BottomNavigationBar).$('Kall').tap();
    await $('Recents').waitUntilVisible();
    final tabs = dumpScreen($, 'Kall screen');
    expect($('Contacts'), findsWidgets, reason: 'the Contacts tab is there; on screen: $tabs');
    expect($('Kool Kall'), findsWidgets, reason: 'the Kool Kall tab is there; on screen: $tabs');

    // Recents fills from the server after the local list: wait up to 10 s for a card.
    final recentCards =
        find.descendant(of: find.byType(KallListWidget), matching: find.byType(Card));
    for (var i = 0; i < 10 && recentCards.evaluate().isEmpty; i++) {
      await $.pump(const Duration(seconds: 1));
    }
    final recents = dumpScreen($, 'Recents');
    final recentsEmpty = find.text('No Kalls Found').evaluate().isNotEmpty;
    final recentsShown = recentCards.evaluate().length;

    await $('Kool Kall').tap();
    for (var i = 0; i < 10 && find.byType(TodaysKoolKallCellWidget).evaluate().isEmpty; i++) {
      await $.pump(const Duration(seconds: 1));
    }
    final koolKalls = dumpScreen($, 'Kool Kall tab');
    final koolEmpty = find.text('No Kool Kalls Found').evaluate().isNotEmpty;
    final firstCard = find.byType(TodaysKoolKallCellWidget).evaluate().isEmpty
        ? null
        : $.tester.widget<TodaysKoolKallCellWidget>(find.byType(TodaysKoolKallCellWidget).first);

    // The phone part is over: reading the phone's account over the API may end its session now.
    final rows = await (await ApiUser.phoneAccountForCleanup()).kallRows();
    final meetings = rows.where((r) => r['subject'] != null).toList();

    if (rows.isEmpty) {
      expect(recentsEmpty, isTrue,
          reason: "the server has no calls for ${Bench.kpostId}, so Recents says 'No Kalls Found'; "
              'on screen: $recents');
    } else {
      expect(recentsShown, greaterThan(0),
          reason: 'the server has ${rows.length} calls for the account, so Recents lists some '
              '(${recentsEmpty ? "it says No Kalls Found" : "no card"}); on screen: $recents');
    }

    if (meetings.isEmpty) {
      expect(koolEmpty, isTrue,
          reason: "the server has no Kool Kalls, so the tab says 'No Kool Kalls Found'; on screen: $koolKalls");
    } else {
      expect(koolEmpty, isFalse,
          reason: 'the server has ${meetings.length} Kool Kalls for the account; on screen: $koolKalls');
      expect(firstCard?.modelData?.subject, meetings.first['subject'],
          reason: "the tab's first card is the server's newest Kool Kall; on screen: $koolKalls");
    }
  });
}
