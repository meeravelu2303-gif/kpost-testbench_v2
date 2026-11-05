import { describeEndpointChecks } from '@engine/endpoint-groups';

/**
 * Every Contacts endpoint, authentication checks (no token, a forged, expired or malformed token is refused). Which endpoints: src/validation-engine/endpoint-groups.ts.
 * The engine runs each endpoint once and every type folder reports its own slice of that run.
 */
describeEndpointChecks('kpost-api', 'contacts', 'authentication');
