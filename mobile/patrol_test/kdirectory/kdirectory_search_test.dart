import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/settings/views/screens/digital_card_type/user_digital_card_type.dart';
import 'package:patrol/patrol.dart';

import '../support/bench.dart';
import '../support/first_run.dart';
import '../support/kdirectory_api.dart';
import '../support/peer_api.dart';

/// KDirectory on the phone, read-only: the search (kdirectory_search_screen.dart,
/// KdirectorySearchResultsWidget, KdirectoryController.getautoSearchWithNameFromApi → contacts/globalSearch/)
/// and the card a result opens (KdirectoryController.showDigitalCard → bottom_sheet_list.dart
/// unKnownContactDigitalCard → UserDigitalCardTypes, filled from profile/getDigitalCard). What the phone
/// shows is compared with what the second user's own profile says (qatest8 over the API). Nothing is added.
void main() {
  /// The second user's name, mobile number and designation from their own profile (profile/getUserProfile/).
  Future<({String name, String mobile, String designation})> peerCard() async {
    final p = await (await ApiUser.peer()).profile();
    final userProfile = (p['userProfile'] as Map?) ?? const {};
    return (
      name: '${p['firstName'] ?? ''} ${p['lastName'] ?? ''}'.trim(),
      mobile: '${p['mobileNumber'] ?? ''}'.trim(),
      designation: '${userProfile['designation'] ?? ''}'.trim(),
    );
  }

  patrolTest('KDirectory finds the second user by KPost ID and their card shows their real details',
      config: benchConfig, ($) async {
    final peer = await peerCard();
    final shownName = capitalizeWords(peer.name);

    await signInWithPassword($);
    await openKDirectorySearch($);
    final listed = await searchKDirectory($, Bench.peerId);
    expect(kdirectoryRow(Bench.peerId), findsOneWidget,
        reason: '${Bench.peerId} is listed for a search by their KPost ID; on screen: $listed');
    expect(
        find.descendant(of: kdirectoryRow(Bench.peerId), matching: textExactly(shownName)),
        findsOneWidget,
        reason: 'the row shows their name as their profile has it ("$shownName")');

    await $(kdirectoryRow(Bench.peerId)).tap();
    await $(UserDigitalCardTypes).waitUntilVisible();
    await $.pump(const Duration(seconds: 2));
    final card = dumpScreen($, 'KDirectory card');
    PatrolFinder onCard(String text) => $(UserDigitalCardTypes).$(textExactly(text));

    expect(onCard(shownName), findsWidgets,
        reason: 'the card heading is the name on their profile ("$shownName"); on screen: $card');
    expect(onCard(Bench.peerId), findsOneWidget,
        reason: 'the card\'s KPost ID line is ${Bench.peerId}; on screen: $card');
    if (peer.mobile.isNotEmpty) {
      expect(onCard(peer.mobile), findsOneWidget,
          reason: 'the card\'s SIM 1 line is the mobile number on their profile (${peer.mobile}); '
              'on screen: $card');
    }
    if (peer.designation.isNotEmpty) {
      expect(onCard(capitalizeWords(peer.designation)), findsOneWidget,
          reason: 'the card shows their designation ("${peer.designation}"); on screen: $card');
    }
  });

  patrolTest('KDirectory finds the second user by name', config: benchConfig, ($) async {
    final peer = await peerCard();
    expect(peer.name, isNotEmpty, reason: 'the second user has a name on their profile');

    await signInWithPassword($);
    await openKDirectorySearch($);
    final listed = await searchKDirectory($, peer.name);
    expect(kdirectoryRow(Bench.peerId), findsOneWidget,
        reason: 'a search for "${peer.name}" lists ${Bench.peerId}; on screen: $listed');
    expect(
        find.descendant(
            of: kdirectoryRow(Bench.peerId), matching: textExactly(capitalizeWords(peer.name))),
        findsOneWidget,
        reason: 'the row shows the name that was searched for');
  });

  patrolTest('a KDirectory search that matches nobody lists nobody and says so', config: benchConfig,
      ($) async {
    final nonsense = 'zzqxnobody${DateTime.now().millisecondsSinceEpoch}';
    final serverFinds = await (await ApiUser.peer()).directorySearch(nonsense);
    expect(serverFinds, isEmpty, reason: 'the server itself finds nobody for "$nonsense"');

    await signInWithPassword($);
    await openKDirectorySearch($);
    final shown = await searchKDirectory($, nonsense);
    expect(kdirectoryResultRows(), findsNothing,
        reason: 'no result row is shown for "$nonsense"; on screen: $shown');
    expect(
        find.byWidgetPredicate((w) =>
            w is Text &&
            RegExp(r'\bno\b.*\b(data|results?|match(es)?|contacts?|users?|records?|one)\b',
                    caseSensitive: false)
                .hasMatch(w.data ?? '')),
        findsWidgets,
        reason: 'an empty search says that nobody was found (kdirectory_search_results_widget.dart '
            'returns an empty SizedBox when the results are empty, so the screen just stays blank); '
            'on screen: $shown');
  });
}
