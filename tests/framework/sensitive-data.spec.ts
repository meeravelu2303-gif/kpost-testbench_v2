import { findingFor } from '@validators/security/sensitive-data.validator';
import { expect, test } from '@fixtures';

/**
 * The disappearing / secret-message fields are ordinary metadata, not credentials — flagging them as
 * an exposed secret is a false positive (it filed 5 invalid CRITICALs, later marked INVALID). Both
 * modes must be treated as benign: `secretMessageExpireTime*` (Disappear As Per Schedule — timed) and
 * the `secret_message_*` id lists (the after-reading mode uses `isVanished`, which has no "secret" in
 * its name). Genuine credential-like `secret*` fields must still be flagged.
 */
test.describe('sensitive-data: disappearing-message fields are benign @framework', () => {
  test('both secret-message forms are NOT flagged, real secrets ARE', () => {
    for (const benign of [
      'secretMessageExpireTimeAsLong',
      'secretMessageExpireTime',
      'secret_message_msgIDs',
      'secretMessageScheduled',
    ]) {
      expect(findingFor(benign, 12345), `${benign} is metadata, not a secret`).toBeUndefined();
    }
    for (const real of ['secretKey', 'secret_key', 'clientSecret', 'secretToken', 'password']) {
      expect(findingFor(real, 'x'), `${real} is a real secret`).toBe('sensitive field name');
    }
  });
});
