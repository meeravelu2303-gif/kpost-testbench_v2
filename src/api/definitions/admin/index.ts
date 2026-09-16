import { contractPaths } from '../../contract/workbook-contract';
import type { EndpointDefinition } from '../../registry/endpoint-definition';
import { adminEmployeeApis } from './employee.api';
import { adminHrApis } from './hr.api';
import { adminRolesApis } from './roles.api';
import { adminWorkplaceApis } from './workplace.api';

/**
 * The KPost **Admin module** (organisation / workplace / HR setup). Suite `admin-api`, host
 * `adminmodule.kpostindia.com`, reached by BUSINESS_M/L admins from "Admin / HR Setup". Full flow,
 * accounts and endpoint→step mapping in `docs/admin-flow.md`; generated contract from
 * `Admin_module.xlsx` (`openapi/admin-api.openapi.json`).
 *
 *   workplace.api.ts  Work Place Setup (tier/variable) + Location Setup + hierarchy   (steps 1–2)
 *   hr.api.ts         HR Breakdown Setup (tier/variable)                              (step 3)
 *   roles.api.ts      Role Posting Setup + Assign Role Posting + suspend/terminate    (steps 4, 6)
 *   employee.api.ts   Employee Data + pincode→address reference                       (step 5)
 */
export const adminApis: EndpointDefinition[] = [
  ...adminWorkplaceApis,
  ...adminHrApis,
  ...adminRolesApis,
  ...adminEmployeeApis,
];

/** Documented admin paths that no definition covers. Asserted by the coverage spec. */
export function uncoveredAdminPaths(): string[] {
  const covered = new Set(
    adminApis.flatMap((api) => [
      `${api.method} ${api.contractPath ?? api.path}`,
      `${api.method} ${api.path}`,
    ]),
  );
  return contractPaths('admin-api').filter(
    (path) => ![...covered].some((key) => key.endsWith(` ${path}`)),
  );
}
