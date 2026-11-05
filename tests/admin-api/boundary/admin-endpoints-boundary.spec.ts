import { describeEndpointChecks } from '@engine/endpoint-groups';

/**
 * Every Admin (HR-Setup) endpoint, boundary checks (just outside a field's limit is refused, exactly at it is accepted). Which endpoints: src/validation-engine/endpoint-groups.ts.
 * The engine runs each endpoint once and every type folder reports its own slice of that run.
 */
describeEndpointChecks('admin-api', 'admin', 'boundary');
