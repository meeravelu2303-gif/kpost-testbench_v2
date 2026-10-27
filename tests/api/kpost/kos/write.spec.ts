import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the KOS (KWord) writes, incl. the undocumented changeDocumentAccess and updateJobId.
 * HOW is owned by the central validation engine; all are destructive, so live cases are guarded.
 */
test.describe('KPost KOS · write', { tag: ['@api', '@platform', '@regression', '@kos'] }, () => {
  describeEndpointCases({ tags: ['kos-write'] });
});
