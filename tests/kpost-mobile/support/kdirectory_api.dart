import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/views/widgets/common_widgets/shimmer_widget.dart';
import 'package:kpost5_2023/widgets/kdirectory/kdirectory_search_results_widget.dart';
import 'package:patrol/patrol.dart';

import 'first_run.dart';
import 'peer_api.dart';

/// KDirectory over the API, for checking what the phone shows against what the server finds.
extension KDirectoryApi on ApiUser {
  /// KDirectory's search with the body the app sends (KdirectoryController.getautoSearchWithNameFromApi →
  /// AutoSearchWithNameRequestModel.toJson; POST contacts/globalSearch/), for the choices the phone tests
  /// make on the first visit: India, English, Personal. Returns the KPost IDs found (lower case). The
  /// server leaves the caller out of its own results (ContactsDirectoryDaoImpl.globalSearch).
  Future<List<String>> directorySearch(String search) async {
    final response = await dio.post<Object>('contacts/globalSearch/', data: {
      'search': search,
      'languageList': ['English'],
      'userTypeList': ['Personal'],
      'countryList': ['India'],
    });
    if (response.statusCode != 200) {
      throw StateError('the KDirectory search failed: HTTP ${response.statusCode}');
    }
    return [
      for (final row in ApiUser.findMaps(response.data, (m) => m['kpostID'] is String))
        '${row['kpostID']}'.toLowerCase(),
    ];
  }
}

/// KDirectory on the phone (shared by the kdirectory and contacts tests).
///
/// The bottom-nav "KDirectory" tab opens kdirectory_screen.dart (Kdirectorywidget): on a fresh install it
/// asks for a country, a language and a vertical, then "Continue" opens kdirectory_search_screen.dart, whose
/// KdirectorySearchResultsWidget has the "Search Contacts" field (a hint), the result rows (a ProfileImage
/// keyed `profile_<kpostID>`, the name, the KPost ID; a CustomCheckbox when the user can still be added) and
/// the "Add to Contact" button.
Future<void> openKDirectorySearch(PatrolIntegrationTester $) async {
  await $(BottomNavigationBar).$('KDirectory').tap();
  await $.pump(const Duration(seconds: 2));
  // First visit: country, language and vertical, then Continue (as add_contact_test.dart does).
  if ($('Continue').exists || $('Select Country').exists) {
    await $('Select Country').tap();
    await $('India').tap();
    await $('Select Language').tap();
    await $('English').tap();
    await $('Personal').tap();
    await $('Continue').tap();
  }
  await kdirectorySearchField($).waitUntilVisible();
}

PatrolFinder kdirectorySearchField(PatrolIntegrationTester $) =>
    $(TextFormField).containing('Search Contacts');

/// Types [text] into the search field and waits for the search to finish: the controller waits 300 ms
/// after typing stops (_searchDebounceDuration), then shows KDirectoryContactListShimmerWidget while
/// contacts/globalSearch/ runs. Returns the screen's texts.
Future<String> searchKDirectory(PatrolIntegrationTester $, String text) async {
  await kdirectorySearchField($).enterText(text);
  await $.pump(const Duration(seconds: 2));
  for (var second = 0; second < 25; second++) {
    if (find.byType(KDirectoryContactListShimmerWidget).evaluate().isEmpty) break;
    await $.pump(const Duration(seconds: 1));
  }
  await $.pump(const Duration(seconds: 1));
  return dumpScreen($, 'KDirectory search "$text"');
}

/// A plain Text whose whole content is [text]. `$('x')` / find.text also match the search field's own
/// EditableText, so a finder for a typed KPost ID or name would hit the field instead of a result.
Finder textExactly(String text) =>
    find.byWidgetPredicate((w) => w is Text && w.data?.trim() == text);

/// The result rows' profile images (one per row; kdirectory_search_results_widget.dart keys each one
/// `profile_<kpostID>`).
Finder kdirectoryResultRows() => find.descendant(
      of: find.byType(KdirectorySearchResultsWidget),
      matching: find.byWidgetPredicate(
          (w) => w.key is ValueKey<String> && (w.key! as ValueKey<String>).value.startsWith('profile_')),
    );

/// The result row (its InkWell) that shows [kpostId] as its KPost ID line.
Finder kdirectoryRow(String kpostId) => find
    .ancestor(
      of: find.descendant(
          of: find.byType(KdirectorySearchResultsWidget), matching: textExactly(kpostId)),
      matching: find.byType(InkWell),
    )
    .first;

/// GetX's String.capitalize, as the app applies it to names ("qatest8 bench" → "Qatest8 Bench").
String capitalizeWords(String value) => value
    .split(' ')
    .map((w) => w.isEmpty ? w : w[0].toUpperCase() + w.substring(1).toLowerCase())
    .join(' ');
