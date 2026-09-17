import { testData } from '@config/test-data.config';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { body, defineKpostEndpoint, pathParams } from '../kpost-endpoint';

/**
 * KPost core **business-admin / User Management** — the `/admin/*` and `/v2/admin/*` ops a company
 * administrator runs (the BUSINESS_S in-app "User Management", and the company/member administration
 * shared by all tiers). Distinct from the `admin-api` Admin/HR-Setup module (its own host); these are
 * `kpost-api` on `devapi2`. Deferred until a business company with members existed — now unblocked
 * (BUSINESS_S has 3 members, BUSINESS_M has 2). Payloads measured from `KPOST_REACTJS_2023_V1`
 * (`Services/Setting.js` + `components/UserManagement/UserManagement.js`).
 *
 * Split by side effect:
 *  - **reads** run on live as the BUSINESS_M admin against our OWN company (`companyID` in the path /
 *    body) — the member list, the company + bank details, and the id/name suggestions (no persistence).
 *  - **writes are `global`** and blocked-with-reason: they **provision or permanently destroy real
 *    member accounts** on external services (`addingUserByAdmin` mints a KPost login; `terminateUser`
 *    removes a member and cannot be undone; `resetPassword` changes a member's credential;
 *    `createOrRemoveBackupAdmin` / `holdOrRelease` / the `updateX` ops change company state). Like
 *    profile's `changePassword`/`deactivate`, they are contract-validated off-live and never driven on
 *    live by default — there is no expendable member to safely act on.
 */

/** Every business-admin op authenticates as the BUSINESS_M company admin (company 1067). */
const asBusinessAdmin = {
  required: true,
  role: 'COMPANY_ADMIN',
  principalKey: 'business-m',
} as const;
const companyId = (): string => String(testData.businessMCompanyId);

export const adminUserManagementApis: EndpointDefinition[] = [
  // ---- reads (live on our own company) ------------------------------------------------------
  defineKpostEndpoint({
    id: 'admin-user-management-details',
    method: 'GET',
    path: '/admin/userManagementDetails/{companyID}',
    summary: "List a company's members (User Management)",
    tags: ['company', 'common-company', 'user-management'],
    authentication: asBusinessAdmin,
    request: pathParams(() => ({ companyID: companyId() })),
    destructive: false,
    productionSafe: true,
  }),
  defineKpostEndpoint({
    id: 'admin-bank-and-company-details',
    method: 'GET',
    path: '/admin/getBankAndCompanyDetails/{companyID}',
    summary: "Read a company's bank + company details",
    tags: ['company', 'common-company'],
    authentication: asBusinessAdmin,
    request: pathParams(() => ({ companyID: companyId() })),
    destructive: false,
    productionSafe: true,
  }),
  defineKpostEndpoint({
    id: 'admin-kpostid-designation-suggestion',
    method: 'POST',
    path: '/v2/admin/createKpostIDAndDesignationSuggestion',
    summary: 'Suggest a KPost ID for a new member (no persistence)',
    tags: ['company', 'common-company'],
    authentication: asBusinessAdmin,
    // `companyName` is documented; sent from the allowlisted QA value so the guard permits it and the
    // payload matches the contract in full. No persistence — a suggestion cannot corrupt anything.
    request: body(() => ({
      designation: 'QA Tester',
      companyID: companyId(),
      companyName: testData.companyName,
    })),
    destructive: false,
    productionSafe: true,
  }),
  defineKpostEndpoint({
    id: 'admin-display-name-suggestion',
    method: 'POST',
    path: '/admin/displayNameSuggestion',
    summary: 'Suggest a display name for a new member (no persistence)',
    tags: ['company', 'common-company'],
    authentication: asBusinessAdmin,
    request: body(() => ({
      companyID: companyId(),
      designation: 'QA Tester',
      companyName: testData.companyName,
    })),
    destructive: false,
    productionSafe: true,
  }),

  // ---- writes (global — blocked-with-reason; provision/destroy real member accounts) ---------
  defineKpostEndpoint({
    id: 'admin-adding-user-by-admin',
    method: 'POST',
    path: '/admin/addingUserByAdmin/',
    summary: 'Create a company member (provisions a real KPost account — external side effect)',
    tags: ['company', 'common-company', 'user-management'],
    authentication: asBusinessAdmin,
    request: body(() => ({
      companyID: companyId(),
      firstName: 'QA',
      lastName: 'Member',
      mobileNumber: testData.mobileAbsent,
      designation: 'QA Tester',
      userType: 'BUSINESS_M',
      requestType: 'newUser',
      language: 'english',
      activeStatus: 'yes',
    })),
    destructive: true,
    sideEffect: 'global',
  }),
  defineKpostEndpoint({
    id: 'admin-terminate-user',
    method: 'POST',
    path: '/admin/terminateUser/',
    summary: 'Terminate a company member (permanent — cannot be undone)',
    tags: ['company', 'common-company', 'user-management'],
    authentication: asBusinessAdmin,
    request: body(() => ({ kpostID: testData.businessMUser1KpostId, companyID: companyId() })),
    destructive: true,
    sideEffect: 'global',
  }),
  defineKpostEndpoint({
    id: 'admin-reset-password',
    method: 'POST',
    path: '/admin/resetPassword/',
    summary: "Reset a member's password (changes their credential)",
    tags: ['company', 'common-company', 'user-management'],
    authentication: asBusinessAdmin,
    request: body(() => ({
      kpostID: testData.businessMUser1KpostId,
      countryID: testData.countryId,
      mobileNumber: testData.mobileAbsent,
      entityType: 'BUSINESS_M',
    })),
    destructive: true,
    sideEffect: 'global',
  }),
  defineKpostEndpoint({
    id: 'admin-hold-or-release',
    method: 'POST',
    path: '/admin/holdOrRelease/',
    summary: 'Hold or release a company member',
    tags: ['company', 'common-company', 'user-management'],
    authentication: asBusinessAdmin,
    request: body(() => ({ kpostID: testData.businessMUser1KpostId, companyID: companyId() })),
    destructive: true,
    sideEffect: 'global',
  }),
  defineKpostEndpoint({
    id: 'admin-create-remove-backup-admin',
    method: 'POST',
    path: '/admin/createOrRemoveBackupAdmin/',
    summary: 'Make or remove a backup admin',
    tags: ['company', 'common-company', 'user-management'],
    authentication: asBusinessAdmin,
    request: body(() => ({
      kpostID: testData.businessMUser1KpostId,
      isBackUpAdmin: true,
      companyID: companyId(),
    })),
    destructive: true,
    sideEffect: 'global',
  }),
  defineKpostEndpoint({
    id: 'admin-update-company-details',
    method: 'POST',
    path: '/v2/admin/updateCompanyDetails',
    summary: 'Update the company details (shared state)',
    tags: ['company', 'common-company'],
    authentication: asBusinessAdmin,
    request: body(() => ({ companyID: companyId() })),
    destructive: true,
    sideEffect: 'global',
  }),
  defineKpostEndpoint({
    id: 'admin-update-bank-account',
    method: 'POST',
    path: '/v2/admin/updateBankAccountDetails',
    summary: 'Update the company bank account (shared state)',
    tags: ['company', 'common-company'],
    authentication: asBusinessAdmin,
    request: body(() => ({ companyID: companyId() })),
    destructive: true,
    sideEffect: 'global',
  }),
  defineKpostEndpoint({
    id: 'admin-update-role',
    method: 'POST',
    path: '/v2/admin/updateRole',
    summary: "Update a member's role (shared state)",
    tags: ['company', 'common-company', 'user-management'],
    authentication: asBusinessAdmin,
    request: body(() => ({ kpostID: testData.businessMUser1KpostId, companyID: companyId() })),
    destructive: true,
    sideEffect: 'global',
  }),
];
