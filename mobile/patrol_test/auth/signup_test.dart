import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:patrol/patrol.dart';

import '../support/bench.dart';
import '../support/first_run.dart';

/// Personal signup on the phone, with a throwaway `mobkpost<N>` account that the runner deletes
/// afterwards (scripts/mobile/signup-account.mjs). The mobile number needs no OTP since Test_ENV
/// 99a6abf48 ("Mobile number Verify Disable"), and the captcha origin is the QA host in the copy.
void main() {
  patrolTest('a new personal user signs up with mobile, details, KPost ID and password', config: benchConfig, ($) async {
    Bench.requireConfig();
    expect(Bench.signupLocal, isNotEmpty, reason: 'run through `npm run mobile:test` (signup identity)');
    await startFreshApp($);
    dumpScreen($, 'sign-in');
    await $('Sign Up').tap();
    await $.pump(const Duration(seconds: 3));
    dumpScreen($, 'after Sign Up');
    await $('Personal').tap();
    await $.pump(const Duration(seconds: 3));
    dumpScreen($, 'after Personal');
    await $('Select Country').tap();
    await $.pump(const Duration(seconds: 2));
    dumpScreen($, 'country sheet');
    await $('India').last.tap();
    await $('Select Language').tap();
    await $.pump(const Duration(seconds: 2));
    dumpScreen($, 'language sheet');
    await $('English').last.tap();
    await $('Select Your KPOST Domain').tap();
    await $.pump(const Duration(seconds: 2));
    dumpScreen($, 'domain sheet');
    await $(RegExp('kpostindia')).last.tap();
    await $.pump(const Duration(seconds: 1));
    dumpScreen($, 'chosen');
    await $('Continue').tap();
    await $.pump(const Duration(seconds: 3));
    dumpScreen($, 'details form');
    await $(TextField).containing(RegExp('Enter Mobile Number')).enterText(Bench.signupMobile);
    await $(TextField).containing('Enter First Name').enterText('QA');
    await $(TextField).containing('Enter Last Name').enterText('Mobile');
    await $(TextField).containing('Enter your Postal Pin Code').enterText('600001');
    await $.pump(const Duration(seconds: 3));
    dumpScreen($, 'typed');
    // A valid pincode opens "Pincode Details" (area, city, state) to confirm.
    await $('Confirm').tap();
    await $.pump(const Duration(seconds: 1));
    await $('Select Gender').scrollTo().tap();
    await $.pump(const Duration(seconds: 2));
    dumpScreen($, 'gender sheet');
    await $('Female').last.tap();
    await $.pump(const Duration(seconds: 2));
    dumpScreen($, 'after gender');
    await $(TextField).containing('Enter Date of Birth').$(IconButton).tap();
    await $.pump(const Duration(seconds: 2));
    dumpScreen($, 'date picker');
    // The picker opens on today, 18 years ago: the youngest age signup accepts.
    await $('OK').tap();
    await $.pump(const Duration(seconds: 1));
    await $(Checkbox).scrollTo().tap();
    await $.pump(const Duration(seconds: 1));
    dumpScreen($, 'details filled');
    await $('Continue').scrollTo().tap();
    await $.pump(const Duration(seconds: 3));
    dumpScreen($, 'confirm screen');
    await $(TextField).containing('Enter Preferred KPOST ID').enterText(Bench.signupLocal);
    await $.pump(const Duration(seconds: 3));
    dumpScreen($, 'kpost id typed');
    await $(TextField).containing('Enter Password').enterText(Bench.password);
    await $(TextField).containing('Enter Confirm Password').enterText(Bench.password);
    await $.pump(const Duration(seconds: 1));
    dumpScreen($, 'passwords typed');
    await $('Submit').scrollTo().tap(settlePolicy: SettlePolicy.noSettle);
    // signup_controller.dart apiSignUp → SignupSuccessPopup ("signup_success") on HTTP 200.
    var created = false;
    for (var second = 1; second <= 30 && !created; second++) {
      await $.pump(const Duration(seconds: 1));
      created = $(RegExp('Successfully completed the Signup')).exists;
    }
    final shown = dumpScreen($, 'after Submit');
    expect(created, isTrue,
        reason: 'the account is created and the success message shows within 30 s; on screen: $shown');
    expect($('Please wait...'), findsNothing,
        reason: 'the "Please wait..." loader is gone once Submit is answered');
  });
}
