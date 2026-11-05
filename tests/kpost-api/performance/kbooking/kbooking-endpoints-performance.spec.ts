import { describeEndpointChecks } from '@engine/endpoint-groups';

/**
 * Every KBooking endpoint, performance checks (response time, payload size, timeouts). Which endpoints: src/validation-engine/endpoint-groups.ts.
 * The engine runs each endpoint once and every type folder reports its own slice of that run.
 */
describeEndpointChecks('kpost-api', 'kbooking', 'performance');
