import { TAGS } from '@config/constants';
import { expect, test } from '@fixtures';
import { API_SMOKE } from './smoke-checks';
import { expectSmokeRead } from './smoke-read';

/**
 * API SMOKE — the build-acceptance gate for the API layer (`npm run test:smoke:api`): every in-scope
 * module's service is up and serves the signed-in user's own data, read-only. Runs before the UI
 * smoke; if it fails, nothing deeper is worth running. Target ≤ 2 min.
 *
 * The checks are data (`smoke-checks.ts`); this file only turns each row into a test.
 */
for (const mod of API_SMOKE) {
  test.describe(
    `SMOKE · API · ${mod.name}`,
    { tag: [TAGS.api, mod.tag, TAGS.smoke, TAGS.sanity, TAGS.regression] },
    () => {
      const gated = mod.gate?.();
      test.skip(gated !== undefined, gated ?? '');

      for (const read of mod.reads) {
        test(`${read.proves} [${read.endpoint}]`, async ({ endpoints }) => {
          await expectSmokeRead(endpoints, read);
        });
      }
    },
  );
}

test.describe(
  'SMOKE · API · Signup & Login · access control',
  { tag: [TAGS.api, TAGS.auth, TAGS.smoke, TAGS.sanity, TAGS.regression, TAGS.security] },
  () => {
    test('a request without a login is refused (401) [signup-login-active-session]', async ({
      endpoints,
    }) => {
      const ex = await endpoints.sendTo(
        'signup-login-active-session',
        {},
        { label: 'smoke:no-token', auth: { header: undefined } },
      );
      expect(ex.transportError, 'the server answered').toBeUndefined();
      expect(ex.status, 'no token → 401, never our data').toBe(401);
    });
  },
);
