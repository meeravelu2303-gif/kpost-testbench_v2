import { testData } from '@config/test-data.config';
import { body, defineKpostEndpoint, pathParams } from '../kpost-endpoint';

/**
 * Company lookups and the company logo.
 *
 * Two of these take a company identifier straight from an untrusted caller and return that
 * company's record with no token at all — `getCompanyDetails` by mobile number,
 * `downloadCompanyLogo` by id. Whether that is acceptable is a product decision, but a bench that
 * does not probe it is not doing its job: the central cross-resource and information-disclosure
 * validators try a neighbouring id and a wrong-tenant id on every run.
 */
const COMPANY_TAGS = ['common', 'common-company'] as const;

export const companyDetailsApi = defineKpostEndpoint({
  id: 'common-company-details',
  method: 'POST',
  path: '/v2/common/getCompanyDetails',
  summary: "Fetch a company's details by mobile number",
  tags: [...COMPANY_TAGS, 'enumeration-surface'],
  destructive: false,
  // The workbook documents this one as a NUMBER while getCompanyDetailsByAdmin uses a string.
  // Sent exactly as documented — normalising it here would hide a real inconsistency.
  request: body(() => ({ mobileNumber: Number(testData.mobileExists) })),
});

export const companyDetailsByAdminApi = defineKpostEndpoint({
  id: 'common-company-details-by-admin',
  method: 'POST',
  path: '/v2/common/getCompanyDetailsByAdmin',
  summary: "Fetch a company's details as an administrator",
  tags: [...COMPANY_TAGS, 'privileged-lookup'],
  /*
   * "ByAdmin" in the name, no token in the contract. Either the name is misleading or the endpoint
   * is missing its authorization check - one of those is a defect. The tag makes it easy to review
   * every such endpoint at once once auth is documented.
   */
  destructive: false,
  request: body(() => ({ mobileNumber: testData.mobileExists })),
});

export const companyDetailsByMobileAndProductApi = defineKpostEndpoint({
  id: 'common-company-details-by-mobile-and-product',
  method: 'POST',
  path: '/v2/common/getCompanyDetailsByMobileNoAndproductId',
  summary: "Fetch a company's details by mobile number and product",
  tags: COMPANY_TAGS,
  destructive: false,
  request: body(() => ({
    mobileNumber: testData.mobileExists,
    productId: testData.productObjectId,
  })),
});

export const companyNameExistApi = defineKpostEndpoint({
  id: 'common-company-name-exist',
  method: 'GET',
  path: '/v2/common/getCompanyNameExistOnKpostAndKsmacc/{companyName}',
  summary: 'Check whether a company name exists on KPost or KSMACC',
  tags: [...COMPANY_TAGS, 'enumeration-surface'],
  destructive: false,
  /*
   * The name travels in the path, so this is the one common endpoint where an injection payload
   * lands in the URL rather than a JSON body. The central injection and XSS validators cover
   * path parameters too, which is why the parameter is declared here rather than inlined.
   */
  request: pathParams(() => ({ companyName: testData.companyNameAbsent })),
});

export const updateCompanyLogoApi = defineKpostEndpoint({
  id: 'common-update-company-logo',
  method: 'POST',
  path: '/common/updateCompanyLogo',
  summary: "Update a company's logo",
  tags: [...COMPANY_TAGS, 'upload'],
  /*
   * Overwrites an existing company's logo - state that company's users see, not data the tests
   * own. `global` keeps it out of a default run until a throwaway company is confirmed.
   */
  destructive: true,
  sideEffect: 'global',
  request: body(() => ({ companyID: testData.companyId })),
});

export const downloadCompanyLogoApi = defineKpostEndpoint({
  id: 'common-download-company-logo',
  method: 'GET',
  path: '/common/downloadCompanyLogo/{companyID}',
  summary: "Download a company's logo",
  tags: [...COMPANY_TAGS, 'binary', 'requires-token'],
  /*
   * Returns an image, not the KPost envelope. `envelope: false` switches off the JSON-shaped
   * checks (structure, schema, data conventions) while keeping status, headers, security,
   * performance and the auth probes - the ones that still mean something for a binary response.
   *
   * **It is the one common endpoint that is NOT public** - confirmed by the API owner, and by the
   * API itself: 401 without a token, 401 with an invalid one. The workbook says nothing about auth
   * on any endpoint, so the bench found this by probing.
   *
   * It runs like everything else now that Signup & Login can issue a token. Its auth cases are the
   * valuable ones here: it is the only endpoint in the module where "reject an unauthenticated
   * caller" is a rule that can be tested at all.
   */
  authentication: { required: true },
  envelope: false,
  contentType: 'image/png',
  destructive: false,
  request: pathParams(() => ({ companyID: testData.companyId })),
});

export const companyApis = [
  companyDetailsApi,
  companyDetailsByAdminApi,
  companyDetailsByMobileAndProductApi,
  companyNameExistApi,
  updateCompanyLogoApi,
  downloadCompanyLogoApi,
];
