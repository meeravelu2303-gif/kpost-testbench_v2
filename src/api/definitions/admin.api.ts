/**
 * Admin module — a separate service (`admin-api`) on its own host `adminmodule.kpostindia.com`,
 * maintained by Karan S; its defects file into the `KPost Admin` Bugzilla product.
 *
 * The endpoints come from the live Admin api-docs (`npm run contract:admin`; the old Admin_module.xlsx was removed 2026-10-26) (converted to `openapi/admin-api.openapi.json`), and
 * the module is reached by BUSINESS_M/L admins from "Admin / HR Setup". Definitions live under
 * `./admin/`; this file re-exports them, mirroring how `kmail.api.ts` re-exports `./kmail`.
 */
export { adminApis } from './admin';
