import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:kpost5_2023/app_common/constants/kpost_icons.dart';
import 'package:kpost5_2023/widgets/item_widgets/profile_widget/dashboard_profile_image_widget.dart';
import 'package:patrol/patrol.dart';

import '../support/bench.dart';
import '../support/first_run.dart';
import '../support/peer_api.dart';

/// Profile picture on the phone: Settings › the avatar › "Profile Options" (app_utils.dart
/// showProfileOptionsDialog, settings_controller.dart removeProfileImage). A picture set over the API
/// can be removed on the phone, and the server then holds none.
///
/// Choosing a new picture goes through the phone's gallery and a third-party image editor, so it is
/// not driven here; the upload endpoint is covered by the KPost API suite. The QA picture is a 665-byte
/// JPEG (the bench's 64 KB cap for the live S3 bucket). If the account had a picture before, a QA
/// picture is left in its place (the original file cannot be read back).
void main() {
  // A plain 48x48 blue JPEG, 665 bytes.
  final qaPicture = base64Decode(
      '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAwADADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDIooor68+VCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//9k=');

  Future<void> openProfileOptions(PatrolIntegrationTester $) async {
    await signInWithPassword($);
    await $(find.byIcon(KPOST.KP_20_Menu_Open)).tap();
    await tapDrawerItem($, 'Settings');
    await $.pump(const Duration(seconds: 2));
    await $(DashboardProfileImage).first.tap();
    await $('Profile Options').waitUntilVisible();
  }

  patrolTest('a profile picture is removed on the phone and the server then holds none',
      config: benchConfig, ($) async {
    final api = await ApiUser.phoneAccountForCleanup();
    final hadPicture = (await api.profileImage()).isNotEmpty;
    await api.setProfileImage(qaPicture);
    try {
      await openProfileOptions($);
      final shown = dumpScreen($, 'Profile Options');
      expect($('Show Profile Picture'), findsOneWidget);
      expect($('Edit Profile Picture'), findsOneWidget);
      expect($('Remove Profile Picture'), findsOneWidget,
          reason: 'with a picture set, Remove is offered (hasProfilePicture loads the picture; '
              'it reads false when that load fails); on screen: $shown');
      await $('Remove Profile Picture').tap();
      await $('Profile Image Removed Successfully').waitUntilVisible();
      expect(await (await ApiUser.phoneAccountForCleanup()).profileImage(), isEmpty,
          reason: 'the server no longer holds a profile picture');
    } finally {
      final cleanup = await ApiUser.phoneAccountForCleanup();
      if (hadPicture) {
        await cleanup.setProfileImage(qaPicture);
      } else {
        await cleanup.removeProfileImage();
      }
    }
  });

  patrolTest('with no profile picture, Remove is not offered', config: benchConfig, ($) async {
    final api = await ApiUser.phoneAccountForCleanup();
    final hadPicture = (await api.profileImage()).isNotEmpty;
    await api.removeProfileImage();
    try {
      await openProfileOptions($);
      dumpScreen($, 'Profile Options');
      expect($('Edit Profile Picture'), findsOneWidget, reason: 'a picture can be chosen');
      expect($('Remove Profile Picture'), findsNothing, reason: 'there is nothing to remove');
    } finally {
      if (hadPicture) await (await ApiUser.phoneAccountForCleanup()).setProfileImage(qaPicture);
    }
  });
}
