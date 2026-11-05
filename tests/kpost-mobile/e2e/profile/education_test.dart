import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:kpost5_2023/settings/views/widget/Education_added_widget.dart';
import 'package:kpost5_2023/settings/views/widget/college-widget.dart';
import 'package:kpost5_2023/settings/views/widget/school_widget.dart';
import 'package:kpost5_2023/settings/views/widget/university_widget.dart';
import 'package:patrol/patrol.dart';

import '../../support/bench.dart';
import '../../support/first_run.dart';
import '../../support/peer_api.dart';

/// Profile › Education on the phone: the list (eduction_added_details.dart, School / College /
/// University tabs, "Add New", an Edit and a Delete icon per card) and the form (education.dart with
/// school_widget.dart, college-widget.dart, university_widget.dart; settings_controller.dart
/// schoolDetailsInfo / collegeDetailsInfo / universityDetailsInfo). What is saved on the phone must be
/// what the server keeps, an entry with no name must not be saved, and a year range must make sense.
/// The server returns each list as a JSON string in arbitrary order, so rows are matched by name.
/// Every entry a test adds is deleted over the API afterwards.
void main() {
  const kinds = ['school', 'college', 'university'];

  /// The ids of every Education entry on the account, by kind.
  Future<Map<String, Set<String>>> educationIds() async {
    final api = await ApiUser.phoneAccountForCleanup();
    return {
      for (final kind in kinds)
        kind: {for (final row in await api.profileList('${kind}Details')) '${row['${kind}ID']}'},
    };
  }

  /// Deletes every Education entry that was not on the account before the test.
  Future<void> removeNew(Map<String, Set<String>> before) async {
    final api = await ApiUser.phoneAccountForCleanup();
    final now = await educationIds();
    for (final kind in kinds) {
      for (final id in now[kind]!.difference(before[kind]!)) {
        await api.deleteEducation(kind, id);
      }
    }
  }

  Future<List<Map<String, dynamic>>> stored(String kind) async =>
      (await ApiUser.phoneAccountForCleanup()).profileList('${kind}Details');

  // The open tab's form. All three tab pages stay built, so an unscoped finder also matches the
  // hidden forms' fields, and scrolling to one of them swipes the tabs to that page.
  const forms = {
    'School': EductionTextfieldwidget,
    'College': CollegeTextfieldwidget,
    'University': UniversityTextfieldwidget,
  };
  var openTab = 'School';

  /// Drawer › Settings › Profile Creation › Education (the list), on the [tab] tab.
  Future<void> openEducation(PatrolIntegrationTester $, {String tab = 'School'}) async {
    openTab = tab;
    await signInWithPassword($);
    await $(find.byIcon(KPOST.KP_20_Menu_Open)).tap();
    await tapDrawerItem($, 'Settings');
    await $('Profile Creation').tap();
    await $('Education').tap();
    await $.pump(const Duration(seconds: 2));
    await $(Tab).containing(tab).tap();
    await $.pump(const Duration(seconds: 1));
  }

  /// From the list: "Add New" on the current tab opens the form.
  Future<void> addNew(PatrolIntegrationTester $) async {
    await $('Add New').tap();
    await $.pump(const Duration(seconds: 2));
  }

  PatrolFinder form(PatrolIntegrationTester $) => $(forms[openTab]!);

  /// Scrolls [target] into view inside the open form's own scroll view. scrollTo() alone scrolls the
  /// first Scrollable it finds, which is the hidden School page's.
  Future<PatrolFinder> reveal(PatrolIntegrationTester $, PatrolFinder target) => target.scrollTo(
        view: find
            .descendant(of: find.byType(forms[openTab]!), matching: find.byType(Scrollable))
            .first,
      );

  PatrolFinder field(PatrolIntegrationTester $, String hint) =>
      form($).$(TextField).containing(hint);

  String textOf(PatrolIntegrationTester $, String hint) =>
      $.tester.widget<TextField>(field($, hint).first).controller?.text ?? '';

  /// Fills the open form's tab ([nameHint] is that tab's name field).
  Future<void> fill(
    PatrolIntegrationTester $, {
    required String nameHint,
    required String name,
    String from = '2015',
    String to = '2019',
    bool college = false,
  }) async {
    await field($, nameHint).enterText(name);
    if (college) {
      await field($, 'Enter Degree').enterText('B.E.');
      await (await reveal($, field($, 'Enter Field'))).enterText('Engineering');
    } else {
      await field($, 'Enter Standard').enterText('12th');
    }
    await (await reveal($, field($, 'Enter Course'))).enterText('Computer Science');
    await (await reveal($, field($, 'Type Message Here...'))).enterText('QA bench achievement');
    await (await reveal($, field($, 'From'))).enterText(from);
    await (await reveal($, field($, 'To'))).enterText(to);
    await $.pump(const Duration(milliseconds: 500));
  }

  /// Taps Save and waits up to 10 s for the form to close (it goes back only on HTTP 200).
  Future<String> save(PatrolIntegrationTester $) async {
    // The empty list's "No Data Found" snackbar sits over Save/Cancel and outlasted 13 s of waiting
    // in a run; it is not what these tests check, so it is cleared.
    for (final messenger in find.byType(ScaffoldMessenger).evaluate()) {
      ((messenger as StatefulElement).state as ScaffoldMessengerState).clearSnackBars();
    }
    await $.pump(const Duration(milliseconds: 500));
    await (await reveal($, form($).$('Save'))).tap();
    for (var second = 0; second < 10; second++) {
      await $.pump(const Duration(seconds: 1));
      if ($('Add New').exists) break;
    }
    return dumpScreen($, 'after Save');
  }

  /// The list card that shows [name]. The list title-cases names ("QA school 1" shows as
  /// "Qa School 1"), so the text is matched ignoring case.
  PatrolFinder card(PatrolIntegrationTester $, String name) => $(find.ancestor(
        of: find.byWidgetPredicate(
            (w) => w is Text && w.data?.toLowerCase() == name.toLowerCase()),
        matching: find.byType(SchoolAddNew),
      ));

  String unique(String what) => 'QA $what ${DateTime.now().millisecondsSinceEpoch}';

  patrolTest('a School is saved, listed, and kept by the server', config: benchConfig, ($) async {
    final before = await educationIds();
    final name = unique('school');
    try {
      await openEducation($);
      await addNew($);
      await fill($, nameHint: 'Enter School Name', name: name);
      final shown = await save($);
      expect(card($, name), findsWidgets, reason: 'the new School is listed; on screen: $shown');
      final row = (await stored('school')).where((r) => r['schoolName'] == name);
      expect(row, hasLength(1), reason: 'the server keeps the School once');
      expect(row.first, containsPair('standard', '12th'));
      expect(row.first, containsPair('course', 'Computer Science'));
      expect(row.first, containsPair('yearFrom', '2015'));
      expect(row.first, containsPair('yearTo', '2019'));
      expect(row.first, containsPair('about', 'QA bench achievement'));
    } finally {
      await removeNew(before);
    }
  });

  patrolTest('a College is saved, listed, and kept by the server', config: benchConfig, ($) async {
    final before = await educationIds();
    final name = unique('college');
    try {
      await openEducation($, tab: 'College');
      await addNew($);
      await fill($, nameHint: 'Enter Collage Name', name: name, college: true);
      final shown = await save($);
      expect(card($, name), findsWidgets, reason: 'the new College is listed; on screen: $shown');
      final row = (await stored('college')).where((r) => r['collegeName'] == name);
      expect(row, hasLength(1), reason: 'the server keeps the College once');
      expect(row.first, containsPair('degree', 'B.E.'));
      expect(row.first, containsPair('field', 'Engineering'));
    } finally {
      await removeNew(before);
    }
  });

  patrolTest('a University is saved, listed, and kept by the server', config: benchConfig,
      ($) async {
    final before = await educationIds();
    final name = unique('university');
    try {
      await openEducation($, tab: 'University');
      await addNew($);
      await fill($, nameHint: 'Enter University Name', name: name, college: true);
      final shown = await save($);
      expect(card($, name), findsWidgets, reason: 'the new University is listed; on screen: $shown');
      final row = (await stored('university')).where((r) => r['universityName'] == name);
      expect(row, hasLength(1), reason: 'the server keeps the University once');
      expect(row.first, containsPair('course', 'Computer Science'));
    } finally {
      await removeNew(before);
    }
  });

  patrolTest('a School with no name is not saved', config: benchConfig, ($) async {
    final before = await educationIds();
    try {
      await openEducation($);
      await addNew($);
      await field($, 'Enter School Name').enterText('');
      await field($, 'Enter Standard').enterText('12th');
      final shown = await save($);
      final added = (await educationIds())['school']!.difference(before['school']!);
      expect(added, isEmpty, reason: 'a School with no name is not stored; on screen: $shown');
    } finally {
      await removeNew(before);
    }
  });

  patrolTest('a College with no name is not saved', config: benchConfig, ($) async {
    final before = await educationIds();
    try {
      await openEducation($, tab: 'College');
      await addNew($);
      await field($, 'Enter Collage Name').enterText('');
      await field($, 'Enter Degree').enterText('B.E.');
      final shown = await save($);
      final added = (await educationIds())['college']!.difference(before['college']!);
      expect(added, isEmpty,
          reason: 'a College with no name is not stored (its Save is always active, unlike '
              "School's, and neither the app nor the server checks the name); on screen: $shown");
    } finally {
      await removeNew(before);
    }
  });

  patrolTest('a University with no name is not saved', config: benchConfig, ($) async {
    final before = await educationIds();
    try {
      await openEducation($, tab: 'University');
      await addNew($);
      await field($, 'Enter University Name').enterText('');
      await field($, 'Enter Degree').enterText('B.E.');
      final shown = await save($);
      final added = (await educationIds())['university']!.difference(before['university']!);
      expect(added, isEmpty,
          reason: 'a University with no name is not stored (Save is always active); on screen: $shown');
    } finally {
      await removeNew(before);
    }
  });

  patrolTest('the Year fields take 4 digits and nothing else', config: benchConfig, ($) async {
    await openEducation($);
    await addNew($);
    await (await reveal($, field($, 'From'))).enterText('20155');
    await $.pump(const Duration(milliseconds: 500));
    expect(textOf($, 'From'), '2015', reason: 'a 5th digit is not taken (LengthLimitingTextInputFormatter(4))');
    await (await reveal($, field($, 'To'))).enterText('ab12');
    await $.pump(const Duration(milliseconds: 500));
    expect(textOf($, 'To'), '12',
        reason: 'letters are not taken in a year (school_widget.dart has a number keyboard but no '
            'digits-only formatter, so a pasted or typed "ab12" stays)');
  });

  patrolTest('a School whose To year is before its From year is not saved', config: benchConfig,
      ($) async {
    final before = await educationIds();
    final name = unique('school backwards');
    try {
      await openEducation($);
      await addNew($);
      await fill($, nameHint: 'Enter School Name', name: name, from: '2020', to: '2010');
      final shown = await save($);
      final row = (await stored('school')).where((r) => r['schoolName'] == name);
      expect(row, isEmpty,
          reason: 'a School from 2020 to 2010 is refused (no year check in the app or the server); '
              'on screen: $shown');
    } finally {
      await removeNew(before);
    }
  });

  patrolTest('editing a School changes that entry on the server, not a new one', config: benchConfig,
      ($) async {
    final before = await educationIds();
    final name = unique('school');
    final renamed = '$name edited';
    try {
      await (await ApiUser.phoneAccountForCleanup()).addSchool(name);
      await openEducation($);
      await card($, name).$(find.byIcon(KPOST.KP_236_Edit)).tap();
      await $.pump(const Duration(seconds: 2));
      expect(textOf($, 'Enter School Name'), name, reason: 'the form opens with the entry filled in');
      await field($, 'Enter School Name').enterText(renamed);
      final shown = await save($);
      final rows = await stored('school');
      final added = (await educationIds())['school']!.difference(before['school']!);
      expect(rows.where((r) => r['schoolName'] == renamed), hasLength(1),
          reason: 'the server keeps the new name; on screen: $shown');
      expect(rows.where((r) => r['schoolName'] == name), isEmpty, reason: 'the old name is gone');
      expect(added, hasLength(1), reason: 'the edit replaced the entry instead of adding one');
    } finally {
      await removeNew(before);
    }
  });

  patrolTest('deleting a School removes it from the list and the server', config: benchConfig,
      ($) async {
    final before = await educationIds();
    final name = unique('school');
    try {
      await (await ApiUser.phoneAccountForCleanup()).addSchool(name);
      await openEducation($);
      await card($, name).$(find.byIcon(KPOST.KP_29_Delete)).tap();
      await $.pump(const Duration(seconds: 3));
      final shown = dumpScreen($, 'after Delete');
      expect(card($, name), findsNothing, reason: 'the card leaves the list; on screen: $shown');
      expect((await stored('school')).where((r) => r['schoolName'] == name), isEmpty,
          reason: 'the server no longer has the School');
    } finally {
      await removeNew(before);
    }
  });
}
