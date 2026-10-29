import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: KNews — the news reference data, the caller's own news settings and the article
 * feed. The feed administration (`/admin/news/*`) is defined but never driven (it changes every
 * user's news). HOW is owned by the central validation engine.
 */
test.describe('KPost KNews · news', { tag: ['@api', '@verticals', '@regression'] }, () => {
  describeEndpointCases({ tags: ['knews'] });
});
