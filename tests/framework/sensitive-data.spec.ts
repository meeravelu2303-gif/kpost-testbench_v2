import { findingFor } from '@validators/security/sensitive-data.validator';
import { expect, test } from '@fixtures';

/**
 * Secret-message fields (`secretMessageExpireTime*`, `secret_message_*`) are metadata, not exposed
 * credentials; genuine credential-like `secret*` fields are still flagged.
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
