import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * The Katchup attachment download, thumbnail and streaming endpoints, through the validation engine.
 * They need a real attachment uuid, so they skip on live with the reason and run in full against the mock.
 */
test.describe('KPost Katchup · attachments', { tag: ['@api', '@katchup', '@regression'] }, () => {
  describeEndpointCases({ tags: ['katchup-attachment'] });
});
