import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: registration and the availability checks a signup form makes.
 * HOW is owned by the central validation engine.
 *
 * Registration writes real accounts, so `signup` and `adminRegistration` only run with
 * ALLOW_DESTRUCTIVE_TESTS=true; every other case here is read-only.
 */
test.describe('KPost Signup & Login · registration', () => {
  describeEndpointCases({ tags: ['signup'] });
});
