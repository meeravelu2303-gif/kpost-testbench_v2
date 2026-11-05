import { describeEndpointChecks } from '@engine/endpoint-groups';

/**
 * Every Group endpoint, contract and schema checks (status, structure, schema, headers, content type, field formats). Which endpoints: src/validation-engine/endpoint-groups.ts.
 * The engine runs each endpoint once and every type folder reports its own slice of that run.
 */
describeEndpointChecks('kpost-api', 'group', 'contract');
