import { expect, test } from '@playwright/test';
import { isStaticAsset } from '../../../src/ui/ui-health';

/**
 * A "broken resource" fails a screen, so only the app's own files may count as one. An API call whose
 * query carries a file name (a cache-buster) is an API call: on 2026-11-04 the avatar of a deleted test
 * group (403, correct) failed 11 screens in one Chromium run because `?v=…jpg` matched as an image.
 */
test.describe('UI health: static asset vs API call @framework', () => {
  test('a file path is a static asset, with or without a query', () => {
    expect(isStaticAsset('http://192.168.0.100/static/js/main.a28db837.js')).toBe(true);
    expect(isStaticAsset('http://192.168.0.100/static/media/logo.png?v=3')).toBe(true);
    expect(isStaticAsset('http://192.168.0.100/fonts/x.woff2#iefix')).toBe(true);
  });

  test('an API call is not a static asset even when its query names a file', () => {
    expect(
      isStaticAsset(
        'http://192.168.0.100:8989/v2/group/downloadGroupProfileImage/qau368%40kpostindia.com/qatest1%40kpostindia.com?v=qau368_kpostindia.com%2Fprofile%2Fqau368_kpostindia.jpg',
      ),
    ).toBe(false);
    expect(
      isStaticAsset('http://192.168.0.100:8989/v2/profile/downloadProfileImage/a%40b.com?v=a.png'),
    ).toBe(false);
  });
});
