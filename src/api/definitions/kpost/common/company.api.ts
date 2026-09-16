import { testData } from '@config/test-data.config';
import { body, defineKpostEndpoint, pathParams } from '../kpost-endpoint';

/**
 * Company lookups and the company logo.
 *
 * Two of the lookups take a company identifier straight from an untrusted caller and return that
 * company's record with no token at all — `getCompanyDetails` by mobile number and
 * `getCompanyDetailsByAdmin`. Whether that is acceptable is a product decision, but a bench that
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
  productionSafe: true,
  // The workbook documents this one as a NUMBER while getCompanyDetailsByAdmin uses a string.
  // Sent exactly as documented — normalising it here would hide a real inconsistency. The BUSINESS_M
  // admin's mobile resolves our OWN company (1067) on live.
  request: body(() => ({ mobileNumber: Number(testData.businessMMobile) })),
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
  /*
   * The name travels in the path, so this is the one common endpoint where an injection payload
   * lands in the URL rather than a JSON body. The central injection and XSS validators cover
   * path parameters too, which is why the parameter is declared here rather than inlined.
   */
  request: pathParams(() => ({ companyName: testData.companyNameAbsent })),
});

/*
 * ## The company-logo trio, corrected from the live application
 *
 * The workbook records all three against `kpostapis.kpostindia.com` and **without the `/v2`
 * prefix**, which is why the bench saw 404s: it was calling paths that do not exist. The API owner
 * supplied working calls from the live application, and the corrected paths answer on our own host:
 *
 *     POST /v2/common/updateCompanyLogo         multipart: file=@img.jpg, text={"companyID":4}
 *     GET  /v2/common/downloadCompanyLogo/{id}
 *     POST /admin/removeCompanyLogo             {"companyId": 4}
 *
 * Three details no schema would have revealed, all taken from those calls:
 *
 *  - **The JSON arguments travel in a form field named `text`.** Not a body, not `data` — a
 *    multipart part called `text` whose value is a JSON string, alongside the image in `file`.
 *  - **`removeCompanyLogo` spells it `companyId`** (lower-case d) where every other endpoint in the
 *    product uses `companyID`. Sent exactly as the working call does; normalising it here would
 *    hide a real inconsistency from whoever has to maintain both.
 *  - **Our tokens carry fewer claims than the owner's, because they come from a different
 *    deployment.** Theirs decodes to `{sub, companyID: 4, role: "admin", …}`; ours carry only
 *    `{sub, exp, deviceID, iat}` — from `userLogin` and `adminUserLogin` alike, for all four
 *    accounts, including the ones just created through `adminRegistration`. That is not an account
 *    problem and no login here can fix it: the reference token's subject `pd@cake.kpost.in` does
 *    not exist on this host (`kpostIdExist` reports it available) and neither does the company
 *    "cake" its domain comes from, so it was signed by another auth service — one build further on,
 *    where `companyID` and `role` were added to the JWT. Ours (`1.0.48:220`) stops at `deviceID`.
 *    Worth knowing, but **not** the reason these fail: see below.
 *
 * ## The download endpoint 500s regardless of the caller
 *
 * Tested on our host with three credentials:
 *
 *     no token at all                              -> 500 (empty body)
 *     our BUSINESS_S token                         -> 500 (empty body)
 *     the owner's admin token (companyID 4, valid) -> 500 (empty body)
 *
 * So the claims hypothesis is **wrong** — the endpoint fails for every caller, and it fails
 * *before authenticating*, since an anonymous request should be 401. Two candidates remain: the
 * route is broken on this host, or it 500s when the company has no logo (which would still be a
 * defect — a missing image is a 404). No company here has one, because `updateCompanyLogo` has
 * never succeeded. Deciding between them means uploading a logo first, which is a write on a
 * company using a token we were given for reference — not something to do unasked.
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
  /*
   * Returns an image, not the KPost envelope. `envelope: false` switches off the JSON-shaped
   * checks (structure, schema, data conventions) while keeping status, headers, security,
   * performance and the auth probes — the ones that still mean something for a binary response.
   */
  authentication: { required: true, role: 'COMPANY_ADMIN' },
  envelope: false,
  contentType: 'image/png',
  destructive: false,
  request: pathParams(() => ({ companyID: testData.companyId })),
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

export const companyApis = [
  companyDetailsApi,
  companyDetailsByAdminApi,
  companyDetailsByMobileAndProductApi,
  companyNameExistApi,
  updateCompanyLogoApi,
  downloadCompanyLogoApi,
  removeCompanyLogoApi,
];
