import { describeEndpointChecks } from '@engine/endpoint-groups';

/**
 * Every Settings endpoint, data-integrity checks (what the API stored is what the database holds). Which endpoints: src/validation-engine/endpoint-groups.ts.
 * The engine runs each endpoint once and every type folder reports its own slice of that run.
 */
describeEndpointChecks('kpost-api', 'settings', 'data-integrity');
