import { testData } from '@config/test-data.config';
import { pathParamSchema, typesOnlySchema } from '@api/schema/sample-schema';
import {
  body,
  defineKpostEndpoint,
  defineUndocumentedKpostEndpoint,
  pathParams,
} from '../kpost-endpoint';

/**
 * Company lookups and the company logo. Two lookups return a company's record with no token, so the
 * cross-resource and information-disclosure validators probe them every run.
 */
const COMPANY_TAGS = ['common', 'common-company'] as const;

export const companyDetailsApi = defineKpostEndpoint({
  id: 'common-company-details',
  method: 'POST',
  path: '/v2/common/getCompanyDetails',
  summary: "Fetch a company's details by mobile number",
  tags: [...COMPANY_TAGS, 'enumeration-surface'],
  destructive: false,
  productionSafe: true,
  // Documented as a number (getCompanyDetailsByAdmin uses a string); sent as documented. Resolves
  // our own company.
  request: body(() => ({ mobileNumber: Number(testData.businessMMobile) })),
});

export const companyDetailsByAdminApi = defineKpostEndpoint({
  id: 'common-company-details-by-admin',
  method: 'POST',
  path: '/v2/common/getCompanyDetailsByAdmin',
  summary: "Fetch a company's details as an administrator",
  tags: [...COMPANY_TAGS, 'privileged-lookup'],
  // "ByAdmin" in the name but no token in the contract; the tag marks it for review.
  destructive: false,
  productionSafe: true,
  request: body(() => ({ mobileNumber: testData.businessMMobile })),
});

export const companyDetailsByMobileAndProductApi = defineKpostEndpoint({
  id: 'common-company-details-by-mobile-and-product',
  method: 'POST',
  path: '/v2/common/getCompanyDetailsByMobileNoAndproductId',
  summary: "Fetch a company's details by mobile number and product",
  tags: COMPANY_TAGS,
  destructive: false,
  productionSafe: true,
  request: body(() => ({
    mobileNumber: testData.businessMMobile,
    productId: testData.productObjectId,
  })),
});

export const companyNameExistApi = defineKpostEndpoint({
  id: 'common-company-name-exist',
  // Live: read-only existence check with a known-absent, allowlisted company name (names no one).
  productionSafe: true,
  method: 'GET',
  path: '/v2/common/getCompanyNameExistOnKpostAndKsmacc/{companyName}',
  summary: 'Check whether a company name exists on KPost or KSMACC',
  tags: [...COMPANY_TAGS, 'enumeration-surface'],
  destructive: false,
  // The name is a path parameter, declared so the injection and XSS probes target the URL.
  request: pathParams(() => ({ companyName: testData.companyNameAbsent })),
  pathParamsSchema: pathParamSchema('companyName'),
  // Types-only, from a captured live body.
  responseSchema: typesOnlySchema({ message: '', urlPath: '', status: 'SUCCESS', statusCode: 200 }),
});

/*
 * The company-logo trio, on the live paths (the workbook omits the `/v2` prefix). The upload sends
 * its JSON arguments in a multipart field named `text`; `removeCompanyLogo` spells it `companyId`,
 * sent as-is.
 */
export const updateCompanyLogoApi = defineKpostEndpoint({
  id: 'common-update-company-logo',
  method: 'POST',
  // Live path. The workbook's `/common/updateCompanyLogo` 404s.
  path: '/v2/common/updateCompanyLogo',
  contractPath: '/common/updateCompanyLogo',
  summary: "Update a company's logo",
  tags: [...COMPANY_TAGS, 'upload', 'needs-admin-token'],
  requirements: ['FR-S05'],
  authentication: { required: true, role: 'COMPANY_ADMIN' },
  // Overwrites state that a company's users see, not data the tests own.
  destructive: true,
  sideEffect: 'global',
  request: () => ({
    multipart: {
      file: {
        name: 'qa-bench-logo.png',
        mimeType: 'image/png',
        // A 1x1 PNG, generated rather than committed: the smallest honest image.
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+6ZlWAAAAAElFTkSuQmCC',
          'base64',
        ),
      },
      // The JSON arguments, as a form field literally named `text`.
      text: JSON.stringify({ companyID: testData.companyId }),
    },
  }),
});

export const downloadCompanyLogoApi = defineKpostEndpoint({
  id: 'common-download-company-logo',
  method: 'GET',
  // Live path; the workbook omits the `/v2` prefix.
  path: '/v2/common/downloadCompanyLogo/{companyID}',
  contractPath: '/common/downloadCompanyLogo/{companyID}',
  summary: "Download a company's logo",
  tags: [...COMPANY_TAGS, 'binary', 'needs-admin-token'],
  requirements: ['FR-S05'],
  // Returns an image, so the JSON-shaped checks are off; status, headers, security and auth still
  // run.
  authentication: { required: true, role: 'COMPANY_ADMIN' },
  envelope: false,
  contentType: 'image/png',
  destructive: false,
  request: pathParams(() => ({ companyID: testData.companyId })),
  pathParamsSchema: pathParamSchema('companyID'),
});

export const removeCompanyLogoApi = defineKpostEndpoint({
  id: 'common-remove-company-logo',
  method: 'POST',
  path: '/admin/removeCompanyLogo',
  summary: "Remove a company's logo",
  tags: [...COMPANY_TAGS, 'needs-admin-token'],
  requirements: ['FR-S05'],
  authentication: { required: true, role: 'COMPANY_ADMIN' },
  destructive: true,
  sideEffect: 'global',
  // `companyId`, not `companyID` — as the working call sends it. See the note above.
  request: body(() => ({ companyId: testData.companyId })),
});

/**
 * Public pre-login profile-image download (the login screen's avatar); not in the workbook, returns
 * an image.
 */
export const downloadProfileImagePublicApi = defineUndocumentedKpostEndpoint({
  id: 'common-download-profile-image',
  method: 'GET',
  path: '/v2/common/downloadProfileImage/{kpostID}',
  summary: "Download a user's profile image (public, pre-login variant used by the login screen)",
  tags: ['common', 'profile-image', 'binary'],
  authentication: { required: false },
  envelope: false,
  contentType: 'image/*',
  destructive: false,
  // Public and read-only; names our own allowlisted kpostID. 204 = no image set (valid empty state).
  productionSafe: true,
  expectedStatus: [200, 204],
  request: pathParams(() => ({ kpostID: testData.kpostId })),
  pathParamsSchema: pathParamSchema('kpostID'),
  evidence:
    'Login.js:1754,2040 (pre-login avatar, no auth token); backend CommonControllerV2.getProfileImage ' +
    '@GetMapping("downloadProfileImage/{kpostID}"), public per SecurityConfiguration /v2/common/**',
});

export const companyApis = [
  companyDetailsApi,
  downloadProfileImagePublicApi,
  companyDetailsByAdminApi,
  companyDetailsByMobileAndProductApi,
  companyNameExistApi,
  updateCompanyLogoApi,
  downloadCompanyLogoApi,
  removeCompanyLogoApi,
];
