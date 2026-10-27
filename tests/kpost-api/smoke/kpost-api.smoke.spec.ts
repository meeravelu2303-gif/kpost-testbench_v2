import { TAGS } from '@config/constants';
import { expect, test } from '@fixtures';
import { API_SMOKE } from '../../support/smoke/smoke-checks';
import { expectSmokeRead } from '../../support/smoke/smoke-read';

/** KPost API smoke: every KPost module's service is up and serves our own data, read-only. Rows: support/smoke/smoke-checks.ts. */
const MODULES = API_SMOKE.filter((mod) => mod.tag !== TAGS.kmail);

for (const mod of MODULES) {
  test.describe(
    `SMOKE · API · ${mod.name}`,
    { tag: [TAGS.api, mod.tag, TAGS.smoke, TAGS.sanity, TAGS.regression] },
    () => {
      const gated = mod.gate?.();
      test.skip(gated !== undefined, `not configured for this run: ${gated ?? ''}`);

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
