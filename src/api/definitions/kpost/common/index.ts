import { contractPaths } from '../../../contract/workbook-contract';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { companyApis } from './company.api';
import { identityApis } from './identity.api';
import { locationApis } from './location.api';
import { otpApis } from './otp.api';
import { platformApis } from './platform.api';

/**
 * The KPost **common** module — every endpoint under `/common` and `/v2/common`.
 *
 * Grouped by what they do rather than by their URL, because that is how they fail:
 *
 *   otp.api.ts       sending and checking OTPs, and password recovery  (side effects: SMS, email)
 *   location.api.ts  countries, states, cities, postcodes, languages   (read-only reference data)
 *   identity.api.ts  "does this exist" lookups                         (enumeration surface)
 *   company.api.ts   company records and the logo                      (cross-tenant surface)
 *   platform.api.ts  service status, app version, enquiry capture      (public writes)
 *
 * None require a token: the common module is what a client talks to before anyone has logged in.
 */
export const commonApis: EndpointDefinition[] = [
  ...otpApis,
  ...locationApis,
  ...identityApis,
  ...companyApis,
  ...platformApis,
];

/**
 * Paths the workbook documents for this module but no definition covers.
 *
 * A module is only "finished" when this is empty, and the assertion lives in a test rather than
 * in a reviewer's memory — see tests/api/kpost/common/coverage.spec.ts. Without it, an endpoint
 * added to a future dump would sit untested and nothing would say so.
 */
export function uncoveredCommonPaths(): string[] {
  // Both the live path and the workbook path it corrects, or a corrected route reads as untested.
  const covered = new Set(
    commonApis.flatMap((api) => [
      `${api.method} ${api.path}`,
      ...(api.contractPath ? [`${api.method} ${api.contractPath}`] : []),
    ]),
  );
  const documented: string[] = [];

  for (const path of contractPaths('kpost-api')) {
    if (!/^\/(v2\/)?common\//i.test(path)) continue;
    documented.push(path);
  }

  return documented.filter((path) => ![...covered].some((key) => key.endsWith(` ${path}`)));
}
