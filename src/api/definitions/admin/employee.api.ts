import { testData } from '@config/test-data.config';
import type { EndpointDefinition } from '../../registry/endpoint-definition';
import { body, pathParams } from '../kpost/kpost-endpoint';
import { defineAdminEndpoint } from './admin-endpoint';

/**
 * Admin module — **Employee Data** (step 5: create the employee record) and the pincode→address
 * reference helper. See `docs/admin-flow.md` §4.
 *
 *   employeeDetails/getEmployeeDetails    the company's employees (read, GET)
 *   employeeDetails/save|update|delete    the employee master record (gated writes)
 *   country/getAddressUsingPincodeAndCountry  reference lookup used by the employee address form
 */

const companyId = (): string => String(testData.businessMCompanyId);

export const adminEmployeeApis: EndpointDefinition[] = [
  defineAdminEndpoint({
    id: 'admin-employee-details',
    method: 'POST',
    path: '/employeeDetails/getEmployeeDetails',
    summary: "Read the company's employee master data",
    tags: ['employee'],
    request: body(() => ({ companyId: companyId() })),
    destructive: false,
    productionSafe: true,
  }),
  defineAdminEndpoint({
    id: 'admin-employee-save',
    method: 'POST',
    path: '/employeeDetails/save',
    summary: 'Create an employee master record',
    tags: ['employee'],
    request: body(() => ({
      companyId: companyId(),
      employeeName: `QA Employee ${Date.now()}`,
      // A known-unused QA number we own (allowlisted), so no stranger is named.
      mobileNo: String(testData.mobileAbsent),
      emailId: 'qa.employee@kpost.in',
    })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-employee-update',
    method: 'POST',
    path: '/employeeDetails/update',
    summary: 'Update an employee master record',
    tags: ['employee'],
    request: body(() => ({ id: 1, companyId: companyId(), employeeName: 'QA Employee edited' })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-employee-delete',
    method: 'POST',
    path: '/employeeDetails/delete',
    summary: 'Delete an employee master record',
    tags: ['employee'],
    request: body(() => ({ id: 1 })),
    destructive: true,
    sideEffect: 'data',
  }),

  // Reference data: pincode + country → address. Read-only, no tenant data named.
  defineAdminEndpoint({
    id: 'admin-country-address-by-pincode',
    method: 'GET',
    path: '/country/getAddressUsingPincodeAndCountry/{pincode}/{country}',
    summary: 'Resolve an address from a pincode and country (employee address helper)',
    tags: ['country-address'],
    request: pathParams(() => ({ pincode: testData.pinCode, country: 'India' })),
    destructive: false,
    productionSafe: true,
  }),
];
