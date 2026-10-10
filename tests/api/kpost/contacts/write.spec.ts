import { forWriteSweep } from '@api/sweep-target';
import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the Contacts writes — add, add several, reference name, block, delete, phone
 * import, invite. HOW is owned by the central validation engine. Requests are aimed at the
 * throwaway account: blocking or deleting the shared counterparty would break every flow that
 * messages or calls it.
 */
test.describe('KPost Contacts · writes', () => {
  describeEndpointCases({ tags: ['contacts-write'] }, { transform: forWriteSweep });
});
