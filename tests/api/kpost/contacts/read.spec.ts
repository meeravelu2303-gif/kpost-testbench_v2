import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the Contacts reads — the address book, groups, imported/blocked lists, and the two
 * search surfaces. HOW is owned by the central validation engine. All run on live (our own account /
 * a harmless search).
 */
test.describe('KPost Contacts · reads', () => {
  describeEndpointCases({ tags: ['contacts-read'] });
});
