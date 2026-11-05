import { describeEndpointChecks } from '@engine/endpoint-groups';

/**
 * Every Contacts endpoint, authorization checks (roles, and no reach into another user's or company's records). Which endpoints: src/validation-engine/endpoint-groups.ts.
 * The engine runs each endpoint once and every type folder reports its own slice of that run.
 */
describeEndpointChecks('kpost-api', 'contacts', 'authorization');
