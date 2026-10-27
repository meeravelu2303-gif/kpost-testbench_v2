import { expect, test } from '@fixtures';

/**
 * Common recorded gaps: save-unsubscriber-details (404, not deployed), update-flutter-app-version
 * (global: changes what every mobile client installs) and the company-logo trio (needs a logo upload,
 * not authorized).
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

    test("common-update-flutter-app-version: no live test (global, public, unauthenticated — controls every mobile client's install prompt)", () => {
      test.skip(
        true,
        "sideEffect:'global', never cleared for live under any flag — the endpoint's own definition " +
          'warns a wrong value here is a production incident. Never run for real; the off-live ' +
          'negative probes are the only thing that touches it.',
      );
      expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
    });

    test('common-update-company-logo / common-download-company-logo / common-remove-company-logo: no live test (COMPANY_ADMIN-gated, already-declined investigation)', () => {
      test.skip(
        true,
        "all three need a COMPANY_ADMIN token and two are sideEffect:'global'. The endpoint " +
          "definitions' own extensive documented investigation (company.api.ts) already traced " +
          "downloadCompanyLogo's 500-for-every-caller to two candidates (a broken route, or a missing-" +
          'logo 500-instead-of-404) and explicitly declined to resolve it by uploading a real logo on ' +
          'a token given for reference, "not something to do unasked." That stands unless the owner ' +
          'explicitly authorizes driving these live.',
      );
      expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
    });
  },
);
