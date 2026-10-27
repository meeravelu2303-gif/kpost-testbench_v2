import { testData } from '@config/test-data.config';
import { pathParamSchema, typesOnlySchema } from '@api/schema/sample-schema';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { body, defineKpostEndpoint, pathParams } from '../kpost-endpoint';

/**
 * KPost core business-admin / User Management ops (`/admin/*`), not the separate Admin/HR-Setup
 * module. Reads run on live against our own company; writes are `global` (they create or destroy
 * real member accounts).
 */

/** Every business-admin op authenticates as the BUSINESS_M company admin. */
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
    pathParamsSchema: pathParamSchema('companyID'),
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
    pathParamsSchema: pathParamSchema('companyID'),
    // Types-only, from a captured live body (the workbook documents no response).
    responseSchema: typesOnlySchema({
      data: {
        companyDetails: [
          { gstNumber: null, address1: '', address2: '', companyName: '', panNumber: null },
        ],
      },
      message: '',
      urlPath: '',
      status: 'SUCCESS',
      statusCode: 200,
    }),
    destructive: false,
    productionSafe: true,
  }),
  defineKpostEndpoint({
    id: 'admin-kpostid-designation-suggestion',
    method: 'POST',
    // The real route has no `/v2`; the schema comes from the workbook's `/v2/admin/` row via
    // contractPath.
    path: '/admin/createKpostIDAndDesignationSuggestion',
    contractPath: '/v2/admin/createKpostIDAndDesignationSuggestion',
    summary: 'Suggest a KPost ID for a new member (no persistence)',
    tags: ['company', 'common-company'],
    authentication: asBusinessAdmin,
    // `companyName` uses the allowlisted QA value; a suggestion persists nothing.
    request: body(() => ({
      designation: 'QA Tester',
      companyID: companyId(),
      companyName: testData.companyName,
    })),
    // Types-only, from a captured live body; this one has no `data` wrapper.
    responseSchema: typesOnlySchema({
      designationSuggestion: '',
      kpostID: '',
      urlPath: '',
      status: 'SUCCESS',
      statusCode: 200,
    }),
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
    // Types-only, from a captured live body; `data` is the suggested name string.
    responseSchema: typesOnlySchema({
      data: '',
      message: '',
      urlPath: '',
      status: 'SUCCESS',
      statusCode: 200,
    }),
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
    // A `global` write, so the schema serves only off-live negative cases.
    requestSchema: typesOnlySchema({
      companyID: companyId(),
      firstName: 'QA',
      lastName: 'Member',
      mobileNumber: testData.mobileAbsent,
      designation: 'QA Tester',
      userType: 'BUSINESS_M',
      requestType: 'newUser',
      language: 'english',
      activeStatus: 'yes',
    }),
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
    // The real route has no `/v2`; the schema comes from the workbook's `/v2/admin/` row via
    // contractPath.
    path: '/admin/updateCompanyDetails',
    contractPath: '/v2/admin/updateCompanyDetails',
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
    // The real route has no `/v2`; the schema comes from the workbook's `/v2/admin/` row via
    // contractPath.
    path: '/admin/updateBankAccountDetails',
    contractPath: '/v2/admin/updateBankAccountDetails',
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
