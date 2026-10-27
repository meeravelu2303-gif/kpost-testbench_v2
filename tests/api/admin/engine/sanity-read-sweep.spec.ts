import { adminApis } from '@api/definitions/admin';
import { TAGS } from '@config/constants';
import { env } from '@config/env';
import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * Admin API sanity sweep: every productionSafe Admin read at the SMOKE profile, as the BUSINESS_M
 * admin. Reads only; the Admin writes run under `npm run product:kpost-admin`.
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
