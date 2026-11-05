import { forWriteSweep } from '@api/sweep-target';
import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * Every Group endpoint, through the validation engine, aimed at the throwaway account instead of the
 * shared counterparty.
 */
test.describe('KPost Group · manage', { tag: ['@api', '@group', '@regression'] }, () => {
  describeEndpointCases(
    { tags: ['group-manage', 'group-read', 'group-image'] },
    { transform: forWriteSweep },
  );
});
