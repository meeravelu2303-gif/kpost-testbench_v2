import { kmailPathPrefix } from '@config/env';
import { expect, test } from '@fixtures';

/**
 * KMail's path prefix follows its host: testkmail sits behind a gateway at `/testkmail/v2`, a KMail
 * server reached directly serves `/v2`. A fixed `/testkmail/v2` made a direct server 404 every request.
 */
test.describe('KMail path prefix @framework', () => {
  test('the testkmail gateway keeps /testkmail/v2', () => {
    expect(kmailPathPrefix(undefined, 'https://testkmail.kpostindia.com')).toBe('/testkmail/v2');
    expect(kmailPathPrefix(undefined, 'https://testkmail.kpostindia.com/testkmail/')).toBe(
      '/testkmail/v2',
    );
  });

  test('a KMail server reached directly uses /v2', () => {
    expect(kmailPathPrefix(undefined, 'http://192.168.0.100:9081')).toBe('/v2');
  });

  test('an explicit KMAIL_PATH_PREFIX always wins', () => {
    expect(kmailPathPrefix('/kmail5/v2', 'http://192.168.0.100:9081')).toBe('/kmail5/v2');
  });

  test('no KMail host configured keeps the old default', () => {
    expect(kmailPathPrefix(undefined, undefined)).toBe('/testkmail/v2');
  });
});
