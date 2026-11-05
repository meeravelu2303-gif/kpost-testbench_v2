import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:kpost5_2023/settings/views/screens/blocked_contacts.dart';
import 'package:kpost5_2023/settings/views/screens/change_language/change_language_screen.dart';
import 'package:kpost5_2023/settings/views/screens/digital_card_settings.dart';
import 'package:kpost5_2023/settings/views/screens/general_settings.dart';
import 'package:kpost5_2023/settings/views/screens/katchup_settings/katchup_settings.dart';
import 'package:kpost5_2023/settings/views/screens/kmail_settings/add_other_mail_accounts_widget.dart';
import 'package:kpost5_2023/settings/views/screens/kmail_settings/instant_reply_screen.dart';
import 'package:kpost5_2023/settings/views/screens/kmail_settings/kmail_settings.dart';
import 'package:kpost5_2023/settings/views/screens/kmail_settings/kmail_signature_screen.dart';
import 'package:kpost5_2023/settings/views/screens/kmail_settings/letter_head_widget.dart';
import 'package:kpost5_2023/settings/views/screens/kmail_settings/vacation_response_screen.dart';
import 'package:kpost5_2023/settings/views/screens/knews_settings/knews_settings_screen.dart';
import 'package:kpost5_2023/settings/views/screens/my_accounts.dart';
import 'package:kpost5_2023/settings/views/screens/personalize_screen.dart';
import 'package:kpost5_2023/settings/views/screens/settings_screens.dart';
import 'package:kpost5_2023/settings/views/widget/account_recovery_widget.dart';
import 'package:kpost5_2023/settings/views/widget/change_theme_widget.dart';
import 'package:kpost5_2023/settings/views/widget/data_storage_widget.dart';
import 'package:kpost5_2023/settings/views/widget/front_setting_widget.dart';
import 'package:kpost5_2023/settings/views/widget/notification_widget.dart';
import 'package:kpost5_2023/settings/views/widget/security_privacy_widget.dart';
import 'package:patrol/patrol.dart';

import '../support/bench.dart';
import '../support/first_run.dart';

/// Drawer › Settings on the phone: every screen that can be opened without changing anything opens
/// on its real content and goes back. Mapped from the Test_ENV source:
/// - settings_screens.dart (ProfileSetting: settingsItemsCopy = Profile Creation, Digital Card Settings,
///   General Settings, KMail Settings, Katchup Settings, KNews Settings, My Account; "App Version")
/// - general_settings.dart + settings_controller.dart generalSettingsItem (Personalize, Data & Storage,
///   Notifications, Security & Privacy, Blocked Contacts, Account Recovery Settings, Change Mobile Number,
///   Set as Primary Device, Change Password, Change Access Code, Fingerprint / Face Recognition Setting)
/// - personalize_screen.dart, change_language_screen.dart, front_setting_widget.dart,
///   change_theme_widget.dart, data_storage_widget.dart, notification_widget.dart,
///   security_privacy_widget.dart, blocked_contacts.dart, account_recovery_widget.dart
/// - kmail_settings/ (kmail_settings.dart, letter_head_widget.dart, kmail_signature_screen.dart,
///   instant_reply_screen.dart, vacation_response_screen.dart, add_other_mail_accounts_widget.dart)
/// - "profile _creation.dart", digital_card_settings.dart, katchup_settings.dart,
///   knews_settings_screen.dart, my_accounts.dart
/// Strings are the en_US.dart values of the source's translation keys.
///
/// Never opened (they send an SMS/OTP, change a credential, or need hardware): Change Mobile Number,
/// Set as Primary Device, Change Password, Change Access Code, Fingerprint / Face Recognition Setting,
/// Delete My Account; Account Recovery's "Verify" is never tapped. Those entries are only checked to be
/// listed. Each screen is checked on its own: a screen that fails is recorded and the walk goes on, and
/// the test fails at the end with every screen that did not open as it should.
void main() {
  /// Drawer › Settings, on the Settings menu.
  Future<void> openSettings(PatrolIntegrationTester $) async {
    await signInWithPassword($);
    await $(find.byIcon(KPOST.KP_20_Menu_Open)).tap();
    await tapDrawerItem($, 'Settings');
    // ProfileSetting asks for storage on every build; an older Android shows a dialog for it.
    if (await $.platform.mobile.isPermissionDialogVisible(timeout: const Duration(seconds: 3))) {
      await $.platform.mobile.grantPermissionWhenInUse();
    }
    await $(ProfileSetting).waitUntilVisible();
  }

  /// Presses Back until [home] (the list the walk started from) is on screen again.
  Future<void> backTo(PatrolIntegrationTester $, PatrolFinder home) async {
    for (var i = 0; i < 4 && !home.exists; i++) {
      await $.platform.android.pressBack();
      await $.pump(const Duration(seconds: 1));
    }
  }

  /// Opens one screen with [open], waits for its widget [screen], checks that every text in [texts]
  /// is on it, and goes back to [home]. A failure is added to [failures] (with what the screen showed)
  /// instead of stopping the walk.
  Future<void> visit(
    PatrolIntegrationTester $, {
    required String name,
    required Future<void> Function() open,
    required PatrolFinder screen,
    required List<String> texts,
    required PatrolFinder home,
    required List<String> failures,
    Future<void> Function()? inside,
  }) async {
    try {
      await open();
      await screen.waitUntilVisible();
      await $.pump(const Duration(seconds: 1));
      final shown = dumpScreen($, name);
      final missing = [for (final t in texts) if (!$(t).exists) t];
      if (missing.isNotEmpty) {
        failures.add('$name opened without ${missing.join(', ')}; on screen: $shown');
      }
      if (inside != null) await inside();
    } catch (e) {
      failures.add('$name did not open: $e; on screen: ${dumpScreen($, '$name failed')}');
    }
    await backTo($, home);
  }

  patrolTest('the Settings menu lists every section', config: benchConfig, ($) async {
    await openSettings($);
    final shown = dumpScreen($, 'Settings menu');
    for (final section in const [
      'Profile Creation',
      'Digital Card Settings',
      'General Settings',
      'KMail Settings',
      'Katchup Settings',
      'KNews Settings',
      'My Account',
    ]) {
      expect($(ListTile).containing(section), findsOneWidget,
          reason: 'the Settings menu lists $section once (settings_screens.dart); on screen: $shown');
    }
    expect($('App Version'), findsOneWidget,
        reason: 'the Settings menu shows the app version; on screen: $shown');
  });

  patrolTest('every General Settings screen that changes nothing opens on its content',
      config: benchConfig, ($) async {
    await openSettings($);
    await $(ListTile).containing('General Settings').scrollTo().tap();
    await $(GeneralSettings).waitUntilVisible();
    final list = $(GeneralSettings);
    final shown = dumpScreen($, 'General Settings');

    final failures = <String>[];
    // The entries that are never opened are still listed.
    for (final entry in const [
      'Personalize',
      'Data & Storage',
      'Notifications',
      'Security & Privacy',
      'Blocked Contacts',
      'Account Recovery Settings',
      'Change Mobile Number',
      'Change Password',
      'Change Access Code',
      'Fingerprint Setting',
      'Face Recognition Setting',
    ]) {
      if (!$(ListTile).containing(entry).exists) failures.add('General Settings does not list $entry');
    }

    final personalize = $(PersonalizeScreen);
    await visit($,
        name: 'Personalize',
        open: () => $(ListTile).containing('Personalize').scrollTo().tap(),
        screen: $(PersonalizeScreen),
        texts: const [
          'Change Language',
          'Font Settings',
          'Change Theme',
          'Digital Card Type',
          'Digital Card Colour',
        ],
        home: list,
        failures: failures,
        inside: () async {
          // Its own sub-screens, opened and closed without choosing anything.
          await visit($,
              name: 'Change Language',
              open: () => $('Change Language').tap(),
              screen: $(ChangeLanguage),
              texts: const ['Change Language'],
              home: personalize,
              failures: failures);
          await visit($,
              name: 'Font Settings',
              open: () => $('Font Settings').tap(),
              screen: $(FontSettings),
              texts: const ['Font Settings', 'Font Size', 'Font Style'],
              home: personalize,
              failures: failures);
          await visit($,
              name: 'Change Theme',
              open: () => $('Change Theme').tap(),
              screen: $(ChangeTheme),
              texts: const ['Change Theme', 'Change Palette', 'Night Mode'],
              home: personalize,
              failures: failures);
        });
    await visit($,
        name: 'Data & Storage',
        open: () => $(ListTile).containing('Data & Storage').scrollTo().tap(),
        screen: $(DataStorageWidget),
        texts: const ['Data & Storage', 'KPOST Cloud Storage', 'Phone Storage'],
        home: list,
        failures: failures);
    await visit($,
        name: 'Notifications',
        open: () => $(ListTile).containing('Notifications').scrollTo().tap(),
        screen: $(NotificationWidget),
        texts: const [
          'Notification',
          'katchup Notification',
          'Message Preview',
          'kMail Notification',
          'KMail Preview',
          'kall Notification',
          'Kall',
          'Vibrate',
          'Do Not Disturb',
        ],
        home: list,
        failures: failures);
    await visit($,
        name: 'Security & Privacy',
        open: () => $(ListTile).containing('Security & Privacy').scrollTo().tap(),
        screen: $(SecurityPrivacyWidget),
        texts: const ['Security & Privacy', 'Profile Picture'],
        home: list,
        failures: failures);
    await visit($,
        name: 'Blocked Contacts',
        open: () => $(ListTile).containing('Blocked Contacts').scrollTo().tap(),
        screen: $(BlockContacts),
        texts: const ['Blocked Contacts', 'Blocked Contact List'],
        home: list,
        failures: failures);
    await visit($,
        name: 'Account Recovery Settings',
        open: () => $(ListTile).containing('Account Recovery Settings').scrollTo().tap(),
        screen: $(AccountRecoveryWidget),
        texts: const ['Account Recovery Settings', 'Recovery Mobile No', 'Recovery Email ID'],
        home: list,
        failures: failures);

    expect(failures, isEmpty,
        reason: 'every General Settings screen opens on its content; General Settings showed: $shown');
  });

  patrolTest('every KMail Settings screen opens on its content', config: benchConfig, ($) async {
    await openSettings($);
    await $(ListTile).containing('KMail Settings').scrollTo().tap();
    await $(KmailSettings).waitUntilVisible();
    final list = $(KmailSettings);
    final shown = dumpScreen($, 'KMail Settings');

    final failures = <String>[];
    await visit($,
        name: 'Letter Head',
        open: () => $(ListTile).containing('Letter Head').scrollTo().tap(),
        screen: $(LetterHeadWidget),
        texts: const ['Letter Head'],
        home: list,
        failures: failures);
    await visit($,
        name: 'Mail Signature',
        open: () => $(ListTile).containing('Mail Signature').scrollTo().tap(),
        screen: $(KMailSignatureScreen),
        texts: const ['Signature preview'],
        home: list,
        failures: failures);
    await visit($,
        name: 'Instant Reply',
        open: () => $(ListTile).containing('Instant Reply').scrollTo().tap(),
        screen: $(InstantReplyScreen),
        texts: const ['Instant Reply', 'Add New'],
        home: list,
        failures: failures);
    await visit($,
        name: 'Vacation Response',
        open: () => $(ListTile).containing('Vacation Response').scrollTo().tap(),
        screen: $(VacationResponseScreen),
        texts: const [
          'Vacation Response',
          'Year',
          'Vacation Message',
          'KMail will send a reply automatically, as sent by you to all Mail received, during your Vacation.',
        ],
        home: list,
        failures: failures);
    await visit($,
        name: 'Add Other Mail Accounts',
        open: () => $(ListTile).containing('Add Other Mail Accounts').scrollTo().tap(),
        screen: $(AddOtherMailAccountsWidget),
        texts: const ['Add Other Mail Accounts'],
        home: list,
        failures: failures);

    expect(failures, isEmpty,
        reason: 'every KMail Settings screen opens on its content; KMail Settings showed: $shown');
  });

  patrolTest(
      'Profile Creation, Digital Card, Katchup, KNews and My Account settings open on their content',
      config: benchConfig, ($) async {
    await openSettings($);
    final menu = $(ProfileSetting);
    final shown = dumpScreen($, 'Settings menu');

    final failures = <String>[];
    await visit($,
        name: 'Profile Creation',
        open: () => $(ListTile).containing('Profile Creation').scrollTo().tap(),
        // "profile _creation.dart" has a space in its name (not imported): matched by its content.
        screen: $('Basic Information'),
        texts: const [
          'Profile Creation',
          'About',
          'Basic Information',
          'Contact Information',
          'Education',
          'Experience',
          'Other Activities',
        ],
        home: menu,
        failures: failures);
    await visit($,
        name: 'Digital Card Settings',
        open: () => $(ListTile).containing('Digital Card Settings').scrollTo().tap(),
        screen: $(DigitalCardSettings),
        texts: const ['Digital Card Settings', 'ON = shown', 'OFF = hidden', 'Mobile Number', 'About'],
        home: menu,
        failures: failures);
    await visit($,
        name: 'Katchup Settings',
        open: () => $(ListTile).containing('Katchup Settings').scrollTo().tap(),
        screen: $(KatchupSettingsScreen),
        texts: const [
          'Katchup Settings',
          'Reset',
          'Katchup Chat Style',
          'Classic Theme',
          'Bubble Theme',
          'Katchup Chat Theme',
        ],
        home: menu,
        failures: failures);
    await visit($,
        name: 'KNews Settings',
        open: () => $(ListTile).containing('KNews Settings').scrollTo().tap(),
        screen: $(KnewsSettingsScreen),
        texts: const ['KNews Settings', 'Country', 'Publications'],
        home: menu,
        failures: failures);
    await visit($,
        name: 'My Account',
        open: () => $(ListTile).containing('My Account').scrollTo().tap(),
        screen: $(MyAccount),
        // Listed only: Delete My Account sends an OTP and deletes the account.
        texts: const ['My Account', 'Delete My Account'],
        home: menu,
        failures: failures);

    expect(failures, isEmpty,
        reason: 'each of these Settings screens opens on its content; the menu showed: $shown');
  });
}
