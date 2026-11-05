import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:patrol/patrol.dart';

import '../../support/bench.dart';
import '../../support/first_run.dart';

/// Personal signup on the phone, the checks before the mobile is verified (signup_screen.dart,
/// user_signup_personal.dart, signup_controller.dart onPressedPersonalContinue): each missing or bad
/// field is refused with the app's own message, and a fully filled form still asks for the mobile to
/// be verified. Nothing here taps Verify with a full number (that sends a real SMS), so no account is
/// created and no phone is texted. The messages are in-app SnackBars.
void main() {
  /// Fresh install → Sign Up → Personal (the country / language / domain screen).
  Future<void> openPersonalSignup(PatrolIntegrationTester $) async {
    Bench.requireConfig();
    await startFreshApp($);
    await $('Sign Up').tap();
    await $('Personal').waitUntilVisible();
    await $('Personal').tap();
    await $('Select Country').waitUntilVisible();
  }

  Future<void> chooseCountryLanguageDomain(PatrolIntegrationTester $) async {
    await $('Select Country').tap();
    await $.pump(const Duration(seconds: 2));
    await $('India').last.tap();
    await $('Select Language').tap();
    await $.pump(const Duration(seconds: 2));
    await $('English').last.tap();
    await $('Select Your KPOST Domain').tap();
    await $.pump(const Duration(seconds: 2));
    await $(RegExp('kpostindia')).last.tap();
    await $.pump(const Duration(seconds: 1));
  }

  /// Through the first screen to the details form.
  Future<void> openDetailsForm(PatrolIntegrationTester $) async {
    await openPersonalSignup($);
    await chooseCountryLanguageDomain($);
    await $('Continue').tap();
    await $(TextField).containing(RegExp('Enter Mobile Number')).waitUntilVisible();
  }

  bool enabled(PatrolIntegrationTester $, String label) {
    final button = find.ancestor(
        of: find.text(label), matching: find.byWidgetPredicate((w) => w is ButtonStyleButton));
    return $.tester.widget<ButtonStyleButton>(button.first).onPressed != null;
  }

  /// Waits up to 5 s for [message] (a 2-second SnackBar) and returns whether it showed.
  Future<bool> shows(PatrolIntegrationTester $, String message) async {
    for (var i = 0; i < 20; i++) {
      if ($(message).exists) return true;
      await $.pump(const Duration(milliseconds: 250));
    }
    return false;
  }

  PatrolFinder field(PatrolIntegrationTester $, Pattern hint) => $(TextField).containing(hint);

  Future<String> typed(PatrolIntegrationTester $, Pattern hint, String text) async {
    await field($, hint).scrollTo().enterText(text);
    await $.pump(const Duration(milliseconds: 500));
    return $.tester.widget<TextField>(field($, hint).first).controller?.text ?? '';
  }

  /// A 10-digit number typed only, never sent: Verify is not tapped.
  const unsentMobile = '9000000999';

  /// Every field of the details form, mobile typed but not verified.
  Future<void> fillDetails(PatrolIntegrationTester $) async {
    await typed($, RegExp('Enter Mobile Number'), unsentMobile);
    await typed($, 'Enter First Name', 'QA');
    await typed($, 'Enter Last Name', 'Mobile');
    await typed($, 'Enter your Postal Pin Code', '600001');
    await $.pump(const Duration(seconds: 3));
    await $('Confirm').tap();
    await $.pump(const Duration(seconds: 1));
    await $('Select Gender').scrollTo().tap();
    await $.pump(const Duration(seconds: 2));
    await $('Female').last.tap();
    await $.pump(const Duration(seconds: 1));
    await field($, 'Enter Date of Birth').$(IconButton).tap();
    await $.pump(const Duration(seconds: 2));
    await $('OK').tap();
    await $.pump(const Duration(seconds: 1));
    await $(Checkbox).scrollTo().tap();
    await $.pump(const Duration(seconds: 1));
  }

  patrolTest('the first screen needs a country before a language, and all three before Continue',
      config: benchConfig, ($) async {
    await openPersonalSignup($);
    expect(enabled($, 'Continue'), isFalse, reason: 'Continue is off with nothing chosen');
    await $('Select Language').tap();
    expect(await shows($, 'Select Country'), isTrue,
        reason: 'choosing a language first asks for the country');
    await chooseCountryLanguageDomain($);
    final shown = dumpScreen($, 'all chosen');
    expect(enabled($, 'Continue'), isTrue,
        reason: 'Continue is on once country, language and domain are chosen; on screen: $shown');
    expect($(RegExp('@kpostindia.com')), findsWidgets, reason: 'India offers the @kpostindia.com domain');
  });

  patrolTest('an empty details form is refused, naming the mobile number first', config: benchConfig,
      ($) async {
    await openDetailsForm($);
    await $('Continue').scrollTo().tap();
    expect(await shows($, 'Mobile Number can not be empty'), isTrue,
        reason: 'the first missing field is named; on screen: ${dumpScreen($, 'empty Continue')}');
  });

  patrolTest('Verify refuses a mobile number shorter than 10 digits without sending anything',
      config: benchConfig, ($) async {
    await openDetailsForm($);
    await typed($, RegExp('Enter Mobile Number'), '900000099');
    await $('Verify').tap();
    expect(await shows($, 'Please Enter Valid Mobile Number'), isTrue,
        reason: 'a 9-digit number is refused; on screen: ${dumpScreen($, 'short Verify')}');
    expect($('Enter Your OTP'), findsNothing, reason: 'no OTP screen opens');
  });

  patrolTest('the fields stop at their limits: mobile 10 digits, names 20 letters, pincode 6 digits',
      config: benchConfig, ($) async {
    await openDetailsForm($);
    expect(await typed($, RegExp('Enter Mobile Number'), '90000a099912'), '9000009991',
        reason: 'letters are dropped and an 11th digit is not taken');
    expect(await typed($, 'Enter First Name', 'Qa1 B@'), 'QaB',
        reason: 'a first name takes letters only');
    expect((await typed($, 'Enter Last Name', 'Q' * 21)).length, 20,
        reason: 'a last name stops at 20 letters');
    expect(await typed($, 'Enter your Postal Pin Code', '60a0b0117'), '600011',
        reason: 'a pincode takes digits only, up to 6');
  });

  patrolTest('a pincode that does not exist is refused', config: benchConfig, ($) async {
    await openDetailsForm($);
    await typed($, 'Enter your Postal Pin Code', '000000');
    final refused = await shows($, 'Invalid postal pincode');
    final shown = dumpScreen($, 'bad pincode');
    expect($('Pincode Details'), findsNothing, reason: 'no area is offered for 000000; on screen: $shown');
    expect(refused, isTrue, reason: 'the user is told the pincode is invalid');
  });

  patrolTest('a missing first name is named', config: benchConfig, ($) async {
    await openDetailsForm($);
    await typed($, RegExp('Enter Mobile Number'), unsentMobile);
    await $('Continue').scrollTo().tap();
    expect(await shows($, 'Firstname field is required'), isTrue,
        reason: 'on screen: ${dumpScreen($, 'no first name')}');
  });

  patrolTest('an invalid optional Email ID is refused', config: benchConfig, ($) async {
    await openDetailsForm($);
    await typed($, RegExp('Enter Mobile Number'), unsentMobile);
    await typed($, 'Enter Email ID', 'not-an-email');
    await $('Continue').scrollTo().tap();
    expect(await shows($, 'Enter Valid EmailID'), isTrue,
        reason: 'on screen: ${dumpScreen($, 'bad email')}');
  });

  patrolTest('a filled form still needs the mobile verified before Continue', config: benchConfig,
      ($) async {
    await openDetailsForm($);
    await fillDetails($);
    dumpScreen($, 'filled, not verified');
    await $('Continue').scrollTo().tap();
    expect(await shows($, 'Verify Mobile Number'), isTrue,
        reason: 'an unverified mobile is refused (Test_ENV 6cc10c491)');
    expect($('Enter Preferred KPOST ID'), findsNothing, reason: 'the KPost ID screen does not open');
  });
}
