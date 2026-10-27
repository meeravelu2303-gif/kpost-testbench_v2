import { TAGS } from '@config/constants';
import { test } from '@fixtures';
import { API_SMOKE } from '../../support/smoke/smoke-checks';
import { expectSmokeRead } from '../../support/smoke/smoke-read';

/** KMail API smoke: the KMail service is up and serves our own mail data, read-only. Rows: support/smoke/smoke-checks.ts. */
const MODULES = API_SMOKE.filter((mod) => mod.tag === TAGS.kmail);

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
