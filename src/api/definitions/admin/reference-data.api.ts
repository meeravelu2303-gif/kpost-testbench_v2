import { testData } from '@config/test-data.config';
import type { EndpointDefinition } from '../../registry/endpoint-definition';
import { body, pathParams, queryParams } from '../kpost/kpost-endpoint';
import { defineAdminEndpoint } from './admin-endpoint';

/**
 * Admin module — reference-data and reporting READS found only by diffing the live OpenAPI contract
 * against the rest of `./admin/*`: country, holiday, demo-request, project, product catalogue and
 * product/employee mapping. Read-only by design.
 *
 * Their WRITE counterparts (`country/save`, `demo/createDemoRequest`, `holiday/saveHoliday`,
 * `productMaster/save`, `productPurchase/save`, `productEmployeeMapping/save` + `saveKpostIdForKams`,
 * `project/saveAllProject`, `employeeRoleMapping/save`, `adminDetails/save`) are DELIBERATELY NOT
 * modeled here: unlike every write already covered (`adminTierAttribute`, `location`, `attribute`,
 * `department`, …), none of these nine has a matching `delete` operation anywhere in the live
 * contract — writing test data through them would create a REAL, PERMANENT record this bench cannot
 * clean up (and `productPurchase`/`productMaster` sound billing/catalogue-adjacent, `demo` sounds
 * lead-gen-adjacent — plausible real-world side effects beyond just an orphaned row). Needs explicit
 * sign-off before any of those nine gets a live write test, the same standard already applied to
 * `ADMIN_ROLE_POSTING_LIVE`.
 */

const companyId = (): string => String(testData.businessMCompanyId);

export const adminReferenceDataApis: EndpointDefinition[] = [
  // ---- country/* --------------------------------------------------------------------------
  defineAdminEndpoint({
    id: 'admin-country-list',
    method: 'GET',
    path: '/country/countryList',
    summary: 'List all countries',
    tags: ['country'],
    destructive: false,
    productionSafe: true,
  }),
  defineAdminEndpoint({
    id: 'admin-country-address-by-pincode-only',
    method: 'GET',
    path: '/country/getAddressUsingPincode/{pincode}',
    summary: 'Resolve an address from a pincode alone (no country)',
    tags: ['country'],
    request: pathParams(() => ({ pincode: testData.pinCode })),
    destructive: false,
    productionSafe: true,
  }),

  // ---- holiday/* ----------------------------------------------------------------------------
  defineAdminEndpoint({
    id: 'admin-holiday-list',
    method: 'GET',
    path: '/holiday/getHoliday',
    summary: 'List configured holidays',
    tags: ['holiday'],
    destructive: false,
    productionSafe: true,
  }),

  // ---- demo/* ---------------------------------------------------------------------------------
  defineAdminEndpoint({
    id: 'admin-demo-request-list',
    method: 'GET',
    path: '/demo/fetchDemoRequest',
    summary: 'List demo requests',
    tags: ['demo'],
    destructive: false,
    productionSafe: true,
  }),

  // ---- project/* ------------------------------------------------------------------------------
  defineAdminEndpoint({
    id: 'admin-project-list',
    method: 'GET',
    path: '/project/fetchAllProject',
    summary: 'List all projects',
    tags: ['project'],
    destructive: false,
    productionSafe: true,
  }),

  // ---- productMaster/* ------------------------------------------------------------------------
  defineAdminEndpoint({
    id: 'admin-product-master-list',
    method: 'GET',
    path: '/productMaster/productList/{companyId}',
    summary: "List the company's product catalogue",
    tags: ['product-master'],
    request: pathParams(() => ({ companyId: companyId() })),
    destructive: false,
    productionSafe: true,
  }),

  // ---- productPurchase/* ----------------------------------------------------------------------
  defineAdminEndpoint({
    id: 'admin-product-purchase-by-company',
    method: 'GET',
    path: '/productPurchase/getPurchaseProductByCompanyId',
    summary: "List the company's purchased products",
    tags: ['product-purchase'],
    request: queryParams(() => ({ companyId: companyId() })),
    destructive: false,
    productionSafe: true,
  }),

  // ---- productEmployeeMapping/* ---------------------------------------------------------------
  defineAdminEndpoint({
    id: 'admin-product-employee-mapping-get',
    method: 'POST',
    path: '/productEmployeeMapping/getMappedEmployeeByCompanyIdAndProductId',
    summary: 'List employees mapped to a product for the company',
    tags: ['product-employee-mapping', 'needs-id'],
    // productId 1 is a placeholder — a real created product (productMaster/save, deferred) is
    // needed for a non-empty result, but the shape/validation battery runs regardless.
    request: body(() => ({ companyId: companyId(), productId: 1 })),
    destructive: false,
  }),
  defineAdminEndpoint({
    id: 'admin-product-employee-mapping-kpost-ids',
    method: 'POST',
    path: '/productEmployeeMapping/getKpostIDsByCompanyIdAndProductId',
    summary: 'List KPost IDs mapped to a product for the company',
    tags: ['product-employee-mapping', 'needs-id'],
    request: body(() => ({ companyId: companyId(), productId: 1 })),
    destructive: false,
  }),
];
