import { describeEndpointChecks } from '@engine/endpoint-groups';

/**
 * Every Katchup endpoint, positive checks (the documented request with a valid login gets its documented answer). Which endpoints: src/validation-engine/endpoint-groups.ts.
 * The engine runs each endpoint once and every type folder reports its own slice of that run.
 */
describeEndpointChecks('kpost-api', 'katchup', 'positive');
