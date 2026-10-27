import { adminApis } from '@api/definitions/admin';
import { TAGS } from '@config/constants';
import { env } from '@config/env';
import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * FULL SANITY · Admin API read sweep — every live-safe Admin / HR-Setup read (the owner's PDF scope)
 * at the engine's SMOKE profile, as the BUSINESS_M company admin. Reads only: the Admin writes run
 * through `npm run product:kpost-admin`, and role-posting writes reach real external KSMACC accounts.
 *
 * Admin joins the SANITY level only (`@admin`); it never carries `@smoke`/`@regression`, which run
 * the KPost accounts and flags. Selection is derived from `productionSafe`, like the KPost sweep.
 */
test.describe(
  'SANITY · Admin API reads',
  { tag: [TAGS.api, TAGS.admin, TAGS.sanity, TAGS.sanitySweep] },
  () => {
    test.skip(!env.ADMIN_API_BASE_URL, 'needs ADMIN_API_BASE_URL (the Admin test box)');
    describeEndpointCases(
      { ids: adminApis.filter((api) => api.productionSafe === true).map((api) => api.id) },
      { profile: 'SMOKE', allowEmpty: true },
    );
  },
);
