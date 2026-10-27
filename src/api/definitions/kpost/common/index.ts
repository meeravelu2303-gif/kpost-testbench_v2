import { contractPaths } from '../../../contract/workbook-contract';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { companyApis } from './company.api';
import { identityApis } from './identity.api';
import { locationApis } from './location.api';
import { otpApis } from './otp.api';
import { platformApis } from './platform.api';

/**
 * The common module (`/common`, `/v2/common`), all public: OTP and recovery, location reference
 * data, identity lookups, company records and platform endpoints.
 */
export const commonApis: EndpointDefinition[] = [
  ...otpApis,
  ...locationApis,
  ...identityApis,
  ...companyApis,
  ...platformApis,
];

/** Documented paths in this module no definition covers; asserted empty by coverage.spec.ts. */
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
