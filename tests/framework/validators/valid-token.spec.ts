import { expect, test } from '@fixtures';
import { validTokenValidator } from '@validators/authentication/valid-token.validator';
import { fakeContext, fixtureEndpoint, verdict } from './support/validator-harness';

/**
 * `authentication.valid-token`: 401 always means the token was refused; 403 does too, unless the
 * endpoint says a refusal is its answer to our account (an admin-only job declaring 403).
 */
test.describe('validator unit · authentication.valid-token', { tag: '@framework' }, () => {
  const loginRequired = { authentication: { required: true } } as const;

  test('a 403 on an ordinary endpoint is a rejected token', async () => {
    const result = await verdict(
      validTokenValidator,
      fakeContext({
        endpoint: fixtureEndpoint({ ...loginRequired, expectedStatus: [200] }),
        primary: { status: 403, body: {} },
      }),
    );
    expect(result.status).toBe('FAILED');
  });

  test('a 403 on an admin-only job that declares 403 is the role check, not the token', async () => {
    const result = await verdict(
      validTokenValidator,
      fakeContext({
        endpoint: fixtureEndpoint({ ...loginRequired, expectedStatus: [403] }),
        primary: { status: 403, body: {} },
      }),
    );
    expect(result.status).toBe('PASSED');
  });

  test('a 401 on an admin-only job is still a rejected token', async () => {
    const result = await verdict(
      validTokenValidator,
      fakeContext({
        endpoint: fixtureEndpoint({ ...loginRequired, expectedStatus: [403] }),
        primary: { status: 401, body: {} },
      }),
    );
    expect(result.status).toBe('FAILED');
  });
});
