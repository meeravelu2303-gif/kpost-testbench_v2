import { uiSuiteForFile } from '../../../src/bug-tracker/findings/bug-candidate';
import {
  uiFingerprint,
  uiFingerprintPath,
} from '../../../src/bug-tracker/findings/bug-fingerprint';
import { expect, test } from '@fixtures';

/**
 * The UI test folders were renamed per product (tests/e2e → tests/kpost-ui, tests/e2e-admin →
 * tests/admin-ui). Every UI bug in Bugzilla carries a tag hashed from the old path; a moved spec must
 * produce the SAME tag, or each of its open bugs would be filed again as new.
 */
test.describe('UI fingerprints survive the folder rename @framework', () => {
  const failure = { prefix: 'KP', title: 'the inbox loads', message: 'Timeout 15000ms exceeded' };

  test('a KPost UI spec keeps the tag it had under tests/e2e', () => {
    expect(uiFingerprint({ ...failure, file: 'tests/kpost-ui/katchup/inbox.spec.ts' })).toBe(
      uiFingerprint({ ...failure, file: 'tests/e2e/katchup/inbox.spec.ts' }),
    );
  });

  test('an Admin UI spec keeps the tag it had under tests/e2e-admin', () => {
    expect(
      uiFingerprint({ ...failure, file: 'tests/admin-ui/screens/admin-screens.spec.ts' }),
    ).toBe(uiFingerprint({ ...failure, file: 'tests/e2e-admin/screens/admin-screens.spec.ts' }));
  });

  test('Windows separators hash the same as forward slashes', () => {
    expect(uiFingerprintPath('tests\\kpost-ui\\kmail\\compose.spec.ts')).toBe(
      'tests/e2e/kmail/compose.spec.ts',
    );
  });

  test('a different spec still gets a different tag', () => {
    expect(uiFingerprint({ ...failure, file: 'tests/kpost-ui/kmail/inbox.spec.ts' })).not.toBe(
      uiFingerprint({ ...failure, file: 'tests/kpost-ui/katchup/inbox.spec.ts' }),
    );
  });

  test('the Admin UI folder still routes to the KPost Admin UI product', () => {
    expect(uiSuiteForFile('tests/admin-ui/screens/admin-screens.spec.ts')).toBe('admin-ui');
    expect(uiSuiteForFile('tests/kpost-ui/katchup/inbox.spec.ts')).toBe('kpost-ui');
  });
});
