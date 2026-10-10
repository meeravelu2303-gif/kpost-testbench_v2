import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the Settings writes — theme, font, and the Katchup/Kall/KMail notification
 * toggles on the caller's own account. HOW is owned by the central validation engine. They act on
 * no other person, so no retargeting is needed.
 */
test.describe('KPost Settings · writes', () => {
  describeEndpointCases({ tags: ['settings-write'] });
});
