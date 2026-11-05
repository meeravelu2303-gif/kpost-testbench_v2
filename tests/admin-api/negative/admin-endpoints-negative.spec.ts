import { describeEndpointChecks } from '@engine/endpoint-groups';

/**
 * Every Admin (HR-Setup) endpoint, negative checks (missing, null, empty, wrong-type, malformed and unknown input is refused cleanly). Which endpoints: src/validation-engine/endpoint-groups.ts.
 * The engine runs each endpoint once and every type folder reports its own slice of that run.
 */
describeEndpointChecks('admin-api', 'admin', 'negative');
