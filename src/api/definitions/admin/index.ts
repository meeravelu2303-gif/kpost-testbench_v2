import { contractPaths } from '../../contract/workbook-contract';
import type { EndpointDefinition } from '../../registry/endpoint-definition';
import { adminEmployeeApis } from './employee.api';
import { adminHrApis } from './hr.api';
import { adminOrgStructureApis } from './org-structure.api';
import { adminReferenceDataApis } from './reference-data.api';
import { adminRolesApis } from './roles.api';
import { adminTierExtraApis } from './tier-extra.api';
import { adminWorkplaceApis } from './workplace.api';

/**
 * The KPost **Admin module** (organisation / workplace / HR setup). Suite `admin-api`, host
 * `adminmodule.kpostindia.com`, reached by BUSINESS_M/L admins from "Admin / HR Setup". Full flow,
 * accounts and endpoint→step mapping in `docs/admin-flow.md`; generated contract from
 * `Admin_module.xlsx` (`openapi/admin-api.openapi.json`).
 *
 *   workplace.api.ts      Work Place Setup (tier/variable) + Location Setup + hierarchy   (steps 1–2)
 *   hr.api.ts             HR Breakdown Setup (tier/variable)                              (step 3)
 *   roles.api.ts          Role Posting Setup + Assign Role Posting + suspend/terminate    (steps 4, 6)
 *   employee.api.ts       Employee Data + pincode→address reference                       (step 5)
 *   tier-extra.api.ts     attribute/variable/hrTier/hrVariable — a second, parallel tier pair
 *                         found only in the live contract, undocumented in any FRD/workbook
 *   org-structure.api.ts  department/designation — a third org-structure pair, same situation
 *   reference-data.api.ts country/holiday/demo/project/product* reads — their writes are
 *                         deliberately NOT modeled (no delete counterpart exists for any of them;
 *                         see that file's own doc comment)
 *
 * `uncoveredAdminPaths()` below is how the last two of these were found: diffing every endpoint this
 * file re-exports against the live OpenAPI's full 112-operation list. 38 of 112 were covered before
 * `tier-extra`/`org-structure`/`reference-data` were added; `userDetails/*` (a separate account/auth
 * surface) and the remaining `rolePosting/*` writes are deliberately still uncovered — see their own
 * call sites for why.
 */
export const adminApis: EndpointDefinition[] = [
  ...adminWorkplaceApis,
  ...adminHrApis,
  ...adminRolesApis,
  ...adminEmployeeApis,
  ...adminTierExtraApis,
  ...adminOrgStructureApis,
  ...adminReferenceDataApis,
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
