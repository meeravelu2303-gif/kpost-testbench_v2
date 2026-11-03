import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:patrol/patrol.dart';

import '../support/bench.dart';
import '../support/first_run.dart';
import '../support/peer_api.dart';

/// Profile › Experience on the phone (settings/views/screens/experience.dart,
/// settings_controller.dart experienceDetailsInfo): what is saved on the phone is what the server
/// keeps, an empty entry is not saved, and the years make sense. The app has no list, edit or delete
/// for Experience (every Save adds a row), so every entry a test adds is deleted over the API.
void main() {
  Future<void> openExperience(PatrolIntegrationTester $) async {
    await signInWithPassword($);
    await $(find.byIcon(KPOST.KP_20_Menu_Open)).tap();
    await tapDrawerItem($, 'Settings');
    await $('Profile Creation').tap();
    await $('Experience').tap();
    await $.pump(const Duration(seconds: 2));
  }

  PatrolFinder field(PatrolIntegrationTester $, String hint) => $(TextField).containing(hint);

  String textOf(PatrolIntegrationTester $, String hint) =>
      $.tester.widget<TextField>(field($, hint).first).controller?.text ?? '';

  Future<void> fill(PatrolIntegrationTester $,
      {required String company, String from = '2018', String to = '2022'}) async {
    await field($, 'Enter Company Name').enterText(company);
    await field($, 'Enter Designation').enterText('QA Engineer');
    await field($, 'Location').scrollTo().enterText('Chennai');
    await field($, 'Type Message Here...').scrollTo().enterText('QA bench achievement');
    await field($, 'From').scrollTo().enterText(from);
    await field($, 'To').scrollTo().enterText(to);
    await $.pump(const Duration(milliseconds: 500));
  }

  /// Taps Save and waits up to 10 s for the form to close (it goes back only on HTTP 200).
  Future<String> save(PatrolIntegrationTester $) async {
    await $('Save').scrollTo().tap();
    for (var second = 0; second < 10; second++) {
      await $.pump(const Duration(seconds: 1));
      if (!field($, 'Enter Company Name').exists) break;
    }
    return dumpScreen($, 'after Save');
  }

  Future<List<Map<String, dynamic>>> stored() async =>
      (await ApiUser.phoneAccountForCleanup()).profileList('experienceDetails');

  Future<Set<String>> experienceIds() async => {for (final r in await stored()) '${r['experienceID']}'};

  Future<void> removeNew(Set<String> before) async {
    final api = await ApiUser.phoneAccountForCleanup();
    for (final id in (await experienceIds()).difference(before)) {
      await api.deleteExperience(id);
    }
  }

  patrolTest('an Experience entry is saved and kept by the server', config: benchConfig, ($) async {
    final before = await experienceIds();
    final company = 'QA company ${DateTime.now().millisecondsSinceEpoch}';
    try {
      await openExperience($);
      await fill($, company: company);
      final shown = await save($);
      expect($('Profile Creation'), findsWidgets,
          reason: 'a saved Experience returns to Profile Creation; on screen: $shown');
      final row = (await stored()).where((r) => r['companyName'] == company);
      expect(row, hasLength(1), reason: 'the server keeps the entry once');
      expect(row.first, containsPair('designation', 'QA Engineer'));
      expect(row.first, containsPair('companyLocation', 'Chennai'));
      expect(row.first, containsPair('achievements', 'QA bench achievement'));
      expect(row.first, containsPair('yearFrom', '2018'));
      expect(row.first, containsPair('yearTo', '2022'));
    } finally {
      await removeNew(before);
    }
  });

  patrolTest('an empty Experience entry is not saved', config: benchConfig, ($) async {
    final before = await experienceIds();
    try {
      await openExperience($);
      for (final hint in ['Enter Company Name', 'Enter Designation', 'Location', 'From', 'To']) {
        await field($, hint).scrollTo().enterText('');
      }
      final shown = await save($);
      expect((await experienceIds()).difference(before), isEmpty,
          reason: 'an entry with no company is not stored (Save is always active and neither the '
              'app nor the server checks a field); on screen: $shown');
    } finally {
      await removeNew(before);
    }
  });

  patrolTest('an Experience whose To year is before its From year is not saved', config: benchConfig,
      ($) async {
    final before = await experienceIds();
    final company = 'QA backwards ${DateTime.now().millisecondsSinceEpoch}';
    try {
      await openExperience($);
      await fill($, company: company, from: '2022', to: '2015');
      final shown = await save($);
      expect((await stored()).where((r) => r['companyName'] == company), isEmpty,
          reason: 'an Experience from 2022 to 2015 is refused; on screen: $shown');
    } finally {
      await removeNew(before);
    }
  });

  patrolTest('the Year fields take 4 digits and nothing else', config: benchConfig, ($) async {
    await openExperience($);
    await field($, 'From').scrollTo().enterText('20188');
    await $.pump(const Duration(milliseconds: 500));
    expect(textOf($, 'From'), '2018', reason: 'a 5th digit is not taken');
    await field($, 'To').scrollTo().enterText('ab22');
    await $.pump(const Duration(milliseconds: 500));
    expect(textOf($, 'To'), '22', reason: 'letters are not taken in a year');
  });

  patrolTest('the form is empty when Experience is opened again after a save', config: benchConfig,
      ($) async {
    final before = await experienceIds();
    try {
      await openExperience($);
      await fill($, company: 'QA company ${DateTime.now().millisecondsSinceEpoch}');
      await save($);
      await $('Experience').tap();
      await $.pump(const Duration(seconds: 2));
      dumpScreen($, 'reopened');
      expect(textOf($, 'Enter Company Name'), isEmpty,
          reason: 'a new entry starts empty, not with the last saved company');
      expect(textOf($, 'Enter Designation'), isEmpty, reason: 'nor the last designation');
    } finally {
      await removeNew(before);
    }
  });
}
