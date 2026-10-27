import { TAGS } from '@config/constants';
import { expect, test } from '@fixtures';
import { ADMIN_API_SMOKE } from '../../support/smoke/smoke-checks';
import { expectSmokeRead } from '../../support/smoke/smoke-read';

/**
 * ADMIN API SMOKE — the Admin / HR-Setup service on the Admin test box is up and serves the company
 * admin's data, read-only. Runs in its own runner stage (`SMOKE · Admin API`), after the KPost smoke,
 * so an unreachable Admin box never blocks the KPost gate. The checks are data (`smoke-checks.ts`).
 */
for (const mod of ADMIN_API_SMOKE) {
  test.describe(
    `SMOKE · Admin API · ${mod.name}`,
    { tag: [TAGS.api, TAGS.admin, TAGS.smoke, TAGS.sanity] },
    () => {
      const gated = mod.gate?.();
      test.skip(gated !== undefined, `not configured for this run: ${gated ?? ''}`);

      for (const read of mod.reads) {
        test(`${read.proves} [${read.endpoint}]`, async ({ endpoints }) => {
          await expectSmokeRead(endpoints, read);
        });
      }

      test('a request without a login is refused (401) [admin-workplace-location-all]', async ({
        endpoints,
      }) => {
        const ex = await endpoints.sendTo(
          'admin-workplace-location-all',
          {},
          { label: 'smoke:admin-no-token', auth: { header: undefined } },
        );
        expect(ex.transportError, 'the Admin server answered').toBeUndefined();
        expect(ex.status, 'no token → 401, never company data').toBe(401);
      });
    },
  );
}
