import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the KOS reads — the KWord document list and K-AI sessions run on live; the
 * doc/session-keyed reads skip (`needs-doc-id`) until the lifecycle creates one. HOW is owned by the
 * central validation engine.
 */
test.describe('KPost KOS · reads', () => {
  describeEndpointCases({ tags: ['kos-read'] });
});
