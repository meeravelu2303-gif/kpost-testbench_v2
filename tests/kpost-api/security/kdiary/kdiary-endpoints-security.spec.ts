import { describeEndpointChecks } from '@engine/endpoint-groups';

/**
 * Every KDiary endpoint, security checks (injection, XSS, JWT, security headers, sensitive-data exposure, rate limits). Which endpoints: src/validation-engine/endpoint-groups.ts.
 * The engine runs each endpoint once and every type folder reports its own slice of that run.
 */
describeEndpointChecks('kpost-api', 'kdiary', 'security');
