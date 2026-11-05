import { describeEndpointChecks } from '@engine/endpoint-groups';

/**
 * Every Admin (HR-Setup) endpoint, contract and schema checks (status, structure, schema, headers, content type, field formats). Which endpoints: src/validation-engine/endpoint-groups.ts.
 * The engine runs each endpoint once and every type folder reports its own slice of that run.
 */
describeEndpointChecks('admin-api', 'admin', 'contract');
