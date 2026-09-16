/**
 * Admin module — a separate service (`admin-api`) on its own host `adminmodule.kpostindia.com`,
 * maintained by Jaganathan Murthy; its defects file into the `KPost Admin` Bugzilla product.
 *
 * The endpoints come from `Admin_module.xlsx` (converted to `openapi/admin-api.openapi.json`), and
 * the module is reached by BUSINESS_M/L admins from "Admin / HR Setup". Definitions live under
 * `./admin/`; this file re-exports them, mirroring how `kmail.api.ts` re-exports `./kmail`.
 */
export { adminApis, uncoveredAdminPaths } from './admin';
