import { expect, test } from '@fixtures';

/**
 * Common recorded gaps: save-unsubscriber-details (404, not deployed). The app version and the
 * company logo are driven on the QA test server: security/privileged-endpoints.spec.ts and
 * common/company-logo-lifecycle.spec.ts.
 */

test.describe(
  'KPost common · recorded gaps',
  {
    tag: ['@api', '@platform', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test('common-save-unsubscriber-details: no live test (404 — route not deployed on this test build)', () => {
      test.skip(
        true,
        'testingapi answers 404 "No matching endpoint for this request" for POST ' +
          'saveUnsubscriberDetails, live-verified 2026-09-24. Not run standalone (a 404 there reads ' +
          'as a false CRITICAL); needs the dev to confirm whether the route is deployed on this build.',
      );
      expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
    });
  },
);
