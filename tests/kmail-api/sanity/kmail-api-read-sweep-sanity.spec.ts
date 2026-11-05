import type { EndpointDefinition } from '@api/registry/endpoint-definition';
import { kmailApis } from '@api/definitions/kmail';
import { TAGS } from '@config/constants';
import { describeEndpointCases } from '@engine/endpoint-cases';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { test } from '@fixtures';

/** KMail sanity read sweep: every live-safe, non-OTP KMail read at the SMOKE profile. */
const liveReads = (apis: readonly EndpointDefinition[]): string[] =>
  apis.filter((api) => api.productionSafe === true && !api.otpDependent).map((api) => api.id);

test.describe(
  'SANITY · API reads · KMail',
  { tag: [TAGS.api, TAGS.kmail, TAGS.sanity, TAGS.sanitySweep] },
  () => {
    // Same gate as every KMail spec, so a refused token is not re-reported per endpoint.
    test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
    describeEndpointCases({ ids: liveReads(kmailApis) }, { profile: 'SMOKE', allowEmpty: true });
  },
);
