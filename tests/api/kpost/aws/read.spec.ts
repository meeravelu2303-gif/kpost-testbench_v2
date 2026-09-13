import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the AWS presigned-URL generators (which run on live) and the attachment
 * check/delete (blocked `needs-attachment` until the lifecycle mints a uuid). HOW is owned by the
 * central validation engine.
 */
test.describe('KPost AWS · endpoints', () => {
  describeEndpointCases({ tags: ['aws'] });
});
