import { expect, test } from '@fixtures';

/**
 * The legacy multipart upload route is not used by the current client, so it has no business-rule
 * test here (recorded skip). The real upload flow is `presigned-attachment-workflow.spec.ts`.
 */
test.describe(
  'KPost Katchup · attachment upload (legacy multipart route)',
  { tag: ['@api', '@katchup', '@regression'] },
  () => {
    test('sendKatchupMsgMultiPart: no live business-rule test (legacy route, superseded by presigned S3 upload)', () => {
      test.skip(
        true,
        'katchup-send-multipart is the OLD direct-upload path — owner-confirmed 2026-09-26 that the ' +
          'current client uses the presigned-URL flow instead (aws-katchup-presigned + a direct S3 PUT ' +
          "+ katchup-send-message's own uuid field). The route stays registered (generic validator " +
          'sweep still runs against it) but its attachment-storage behaviour is no longer product-' +
          'relevant, so it is not asserted on live. The prior finding is closed as #614 WONTFIX, not ' +
          'chased further. See presigned-attachment-workflow.spec.ts for the current, real upload path.',
      );
      expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
    });
  },
);
