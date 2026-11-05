import { describeEndpointChecks } from '@engine/endpoint-groups';

/**
 * Every Signup & Login endpoint, positive checks (the documented request with a valid login gets its documented answer). Which endpoints: src/validation-engine/endpoint-groups.ts.
 * The engine runs each endpoint once and every type folder reports its own slice of that run.
 */
describeEndpointChecks('kpost-api', 'signup-login', 'positive');
