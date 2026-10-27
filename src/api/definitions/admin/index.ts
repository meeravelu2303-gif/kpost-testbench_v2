import type { EndpointDefinition } from '../../registry/endpoint-definition';
import { adminEmployeeApis } from './employee.api';
import { adminHrApis } from './hr.api';
import { adminRolesApis } from './roles.api';
import { adminWorkplaceApis } from './workplace.api';

/**
 * The Admin module (`admin-api`): workplace, HR, role-posting and employee setup. Scope is exactly
 * the endpoints in the owner's PDF (`docs/api-specs/Admin_module - API Services.pdf`).
 */
export const adminApis: EndpointDefinition[] = [
  ...adminWorkplaceApis,
  ...adminHrApis,
  ...adminRolesApis,
  ...adminEmployeeApis,
];
