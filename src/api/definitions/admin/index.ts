import type { EndpointDefinition } from '../../registry/endpoint-definition';
import { adminEmployeeApis } from './employee.api';
import { adminHrApis } from './hr.api';
import { adminRolesApis } from './roles.api';
import { adminWorkplaceApis } from './workplace.api';

/**
 * The KPost **Admin module** (organisation / workplace / HR setup). Suite `admin-api`, host
 * `adminmodule.kpostindia.com`, reached by BUSINESS_M/L admins from "Admin / HR Setup".
 *
 * Scope is deliberately the **36 endpoints in the owner's authoritative payload doc**
 * (`docs/api-specs/Admin_module - API Services.pdf`, 2026-09-19) and nothing else — a 2026-10-06 decision to stop
 * testing/filing against anything the module's documentation doesn't cover, even endpoints this
 * bench previously found real, filed security defects on (department/*, attribute/*, variable/*,
 * hrTier/*, hrVariable/*, workplaceHierarchy save/update/delete/getOrganization, every
 * specific-record `getAttribute`/`getAllVariable`/`getReportingLocationName` read, and the
 * country/holiday/demo/project/product reference reads). Those definitions, and the
 * `org-structure.api.ts` / `reference-data.api.ts` / `tier-extra.api.ts` files that held them, were
 * removed outright; the already-filed bugs they covered (e.g. the `admin-department-by-company`
 * cross-tenant CRITICAL) lose bench regression coverage and can only be re-verified manually now.
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
