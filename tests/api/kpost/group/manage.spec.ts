import { forWriteSweep } from '@api/sweep-target';
import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: every Group endpoint — create, members, admin, rename, leave, delete, image, the
 * detail read and the V1 legacy remove-member route. HOW is owned by the central validation engine.
 * Requests are aimed at the throwaway account instead of the shared counterparty.
 */
test.describe('KPost Group · manage', () => {
  describeEndpointCases(
    { tags: ['group-manage', 'group-read', 'group-image'] },
    { transform: forWriteSweep },
  );
});
