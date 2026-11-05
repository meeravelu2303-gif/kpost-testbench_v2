import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/KBooking/views/screens/kbooking_seat_selection_screen.dart';
import 'package:kpost5_2023/KBooking/views/widgets/seat_loading_state.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:patrol/patrol.dart';

import '../support/bench.dart';
import '../support/first_run.dart';
import '../support/kbooking_api.dart';
import '../support/peer_api.dart';

/// KBooking on the phone, read-only (lib/KBooking). Drawer › KBooking opens kbooking_dashboard_screen.dart:
/// the app bar says "KBooking" with a bell (KP_100_Notification) to My Tickets, and four tabs
/// (KBookingDashboardController.bookingTabKeys): KBus (kbooking_kbus_dashboard_screen.dart, the bus ticket
/// form), KTrains, KFlights and KHotels ("<tab>\tComing Soon"). A bus search opens
/// kbooking_kbus_trip_availability_screen.dart ("<from> ↔ <to>", "<n> Buses Found", "View Seats" per bus)
/// and View Seats opens kbooking_seat_selection_screen.dart (tabs Select Seat / Board and Drop Point /
/// Passenger Info). The tests stop there: they never block a seat, book or pay (the payment screen uses
/// the live Razorpay key), so nothing is written.
void main() {
  /// Drawer › KBooking, on the KBus tab.
  Future<void> openKBooking(PatrolIntegrationTester $) async {
    await signInWithPassword($);
    await $(find.byIcon(KPOST.KP_20_Menu_Open)).tap();
    await tapDrawerItem($, 'KBooking');
    await $('Ticket Booking').waitUntilVisible();
    await $.pump(const Duration(seconds: 1));
  }

  PatrolFinder field(PatrolIntegrationTester $, String hint) => $(TextField).containing(hint);

  /// A suggestion row whose text is exactly [name]. The suggestion list highlights the typed part in a
  /// RichText (kbooking_kbus_dashboard_screen.dart _buildCitySuggestionItem), and a Text builds a RichText
  /// too, so both are matched by their plain text; the field's own EditableText is not a RichText.
  Finder suggestion(String name) => find.byWidgetPredicate(
      (w) => w is RichText && w.text.toPlainText().trim().toLowerCase() == name.toLowerCase());

  Future<void> pickCity(PatrolIntegrationTester $, String hint, String name) async {
    await field($, hint).enterText(name);
    for (var second = 0; second < 15; second++) {
      await $.pump(const Duration(seconds: 1));
      if (suggestion(name).evaluate().isNotEmpty) break;
    }
    final shown = dumpScreen($, '$hint suggestions');
    expect(suggestion(name), findsWidgets,
        reason: '"$name" is offered under "$hint"; on screen: $shown');
    await $(suggestion(name)).first.tap();
    await $.pump(const Duration(seconds: 1));
  }

  patrolTest('KBooking opens on KBus with the bus ticket form', config: benchConfig, ($) async {
    await openKBooking($);
    final shown = dumpScreen($, 'KBooking');
    expect($('KBooking'), findsWidgets, reason: 'the app bar says KBooking; on screen: $shown');
    for (final tab in ['KBus', 'KTrains', 'KFlights', 'KHotels']) {
      expect($(Tab).containing(tab), findsOneWidget, reason: 'the $tab tab is shown; on screen: $shown');
    }
    expect($('Ticket Booking'), findsOneWidget, reason: 'the KBus heading; on screen: $shown');
    expect(field($, 'Booking From'), findsOneWidget, reason: 'the From field');
    expect(field($, 'Booking To'), findsOneWidget, reason: 'the To field');
    expect($('Date of Journey'), findsOneWidget, reason: 'the date field; on screen: $shown');
    expect($('Today'), findsOneWidget, reason: 'the Today shortcut; on screen: $shown');
    expect($('Tomorrow'), findsOneWidget, reason: 'the Tomorrow shortcut; on screen: $shown');
    expect($(ElevatedButton).containing('Search Bus'), findsOneWidget,
        reason: 'the Search Bus button; on screen: $shown');
  });

  patrolTest('the KTrains, KFlights and KHotels tabs say they are coming soon', config: benchConfig,
      ($) async {
    await openKBooking($);
    for (final tab in ['KTrains', 'KFlights', 'KHotels']) {
      await $(Tab).containing(tab).tap();
      await $.pump(const Duration(seconds: 2));
      final shown = dumpScreen($, '$tab tab');
      expect($('$tab\tComing Soon'), findsOneWidget,
          reason: 'the $tab tab says "$tab Coming Soon"; on screen: $shown');
    }
  });

  patrolTest('Search Bus with no route does not open a bus list', config: benchConfig, ($) async {
    await openKBooking($);
    await $(ElevatedButton).containing('Search Bus').tap();
    await $.pump(const Duration(seconds: 3));
    final shown = dumpScreen($, 'after Search Bus with an empty form');
    // searchBus() refuses an incomplete form with a toast (not readable here) and stays on the form.
    expect(find.textContaining('Buses Found'), findsNothing,
        reason: 'no bus list opens without a route; on screen: $shown');
    expect($('Ticket Booking'), findsOneWidget, reason: 'the form is still shown; on screen: $shown');
  });

  patrolTest("a bus search lists the route's buses and opens a bus's seat details",
      config: benchConfig, ($) async {
    // A real route from the server's own lists (any account can read them): the first "Chennai" city
    // and the first city buses run to from it.
    final api = await ApiUser.peer();
    final cities = await api.busCities('Chennai');
    expect(cities, isNotEmpty, reason: 'redbus/citysuggestion/Chennai offers a city');
    final from = cities.first;
    final destinations = await api.busDestinations(from.id);
    expect(destinations, isNotEmpty, reason: 'redbus/destinations/ lists where buses go from ${from.name}');
    final to = destinations.first;

    await openKBooking($);
    await pickCity($, 'Booking From', from.name);
    await pickCity($, 'Booking To', to);
    await $('Tomorrow').tap();
    await $(ElevatedButton).containing('Search Bus').tap();

    final found = find.textContaining('Buses Found');
    for (var second = 0; second < 45; second++) {
      await $.pump(const Duration(seconds: 1));
      if (found.evaluate().isNotEmpty) break;
    }
    final listed = dumpScreen($, 'bus list');
    expect(found, findsOneWidget, reason: 'the bus list loads; on screen: $listed');
    expect(find.textContaining('${from.name} ↔ $to'), findsOneWidget,
        reason: 'the list is for ${from.name} → $to; on screen: $listed');
    final count = int.tryParse(
            RegExp(r'^\s*(\d+)').firstMatch($.tester.widget<Text>(found).data ?? '')?.group(1) ?? '') ??
        0;
    expect(count, greaterThan(0),
        reason: 'buses run tomorrow on a route the server itself lists; on screen: $listed');
    expect($('View Seats'), findsWidgets, reason: 'each bus has View Seats; on screen: $listed');

    await $('View Seats').first.tap();
    await $(KBookingSeatSelectionScreen).waitUntilVisible();
    for (var second = 0; second < 30; second++) {
      await $.pump(const Duration(seconds: 1));
      if (find.byType(SeatLoadingState).evaluate().isEmpty) break;
    }
    final seats = dumpScreen($, 'seat details');
    for (final tab in ['Select Seat', 'Board and Drop Point', 'Passenger Info']) {
      expect($(Tab).containing(tab), findsOneWidget, reason: 'the "$tab" tab; on screen: $seats');
    }
    expect(find.byType(SeatErrorState), findsNothing,
        reason: "the bus's seat layout loads (redbus tripdetails) instead of an error; on screen: $seats");
  });

  patrolTest("My Tickets lists the account's bookings as the server has them", config: benchConfig,
      ($) async {
    await openKBooking($);
    await $(find.byIcon(KPOST.KP_100_Notification)).first.tap();
    await $('My Tickets').waitUntilVisible();
    final emptyTabs = <String>[];
    var shown = '';
    for (final tab in ['Upcoming', 'Completed', 'Cancelled']) {
      await $(Tab).containing(tab).tap();
      await $.pump(const Duration(seconds: 3));
      shown = '$shown\n$tab: ${dumpScreen($, 'My Tickets $tab')}';
      if ($('No tickets found').exists) emptyTabs.add(tab);
    }

    final tickets = await (await ApiUser.phoneAccountForCleanup()).busTickets();
    if (tickets.isEmpty) {
      expect(emptyTabs, hasLength(3),
          reason: 'the account has no tickets, so every tab says "No tickets found"; on screen: $shown');
    } else {
      expect(emptyTabs.length, lessThan(3),
          reason: 'the account has ${tickets.length} ticket(s), so at least one tab lists them; '
              'on screen: $shown');
    }
  });
}
