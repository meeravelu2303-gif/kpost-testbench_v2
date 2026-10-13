import { AUTH_PROFILES } from '@config/auth-profile';
import { TAGS } from '@config/constants';
import { expect, test } from '@fixtures';

/**
 * API SMOKE — the build-acceptance gate for the API layer: an "is the API up?" reachability check
 * plus one shallow, safe check per in-scope core module (Auth, Katchup, Kall, KMail). Read-only (no
 * data created), so it is safe to run often and in production. Target runtime ≤ 2 min. If any of these
 * fails the build is not worth deeper testing.
 */
const A = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal');

test.describe(
  'KPost API · smoke',
  { tag: [TAGS.api, TAGS.regression, TAGS.smoke, TAGS.sanity] },
  () => {
    test.skip(!A, 'needs a configured KPost principal');

    test('platform — the API is up (msStatus)', { tag: [TAGS.platform] }, async ({ endpoints }) => {
      // Cheapest reachability check. We assert only that the service answers 200 (is it up?) — the
      // documented-vs-plaintext envelope drift on this endpoint is a separate finding the engine's
      // normal validator sweep surfaces for review, not a smoke-gate concern.
      const ex = await endpoints.sendTo(
        'common-ms-status',
        {},
        { label: 'smoke:ms-status', auth: { principal: A! } },
      );
      expect(ex.status, 'msStatus responds 200 — the API is up').toBe(200);
    });

    test(
      'auth — a signed-in principal has a valid active session',
      { tag: [TAGS.auth] },
      async ({ endpoints }) => {
        // The fixture authenticates principal A (login). A productionSafe read of the active session
        // proves the token/session the login issued is valid — i.e. auth works end-to-end.
        const ex = await endpoints.sendTo(
          'signup-login-active-session',
          {},
          { label: 'smoke:auth', auth: { principal: A! } },
        );
        expect(ex.status, 'activeSession responds 200 for a logged-in principal').toBe(200);
      },
    );

    test(
      'katchup — unopened-count read responds',
      { tag: [TAGS.katchup] },
      async ({ endpoints }) => {
        const ex = await endpoints.sendTo(
          'katchup-unopened-count',
          {},
          { label: 'smoke:katchup', auth: { principal: A! } },
        );
        expect(ex.status, 'getUnopenedMessagesCount responds 200').toBe(200);
      },
    );

    test('kall — frequent-contacts read responds', { tag: [TAGS.kall] }, async ({ endpoints }) => {
      const ex = await endpoints.sendTo(
        'kall-frequent-contacts',
        {},
        { label: 'smoke:kall', auth: { principal: A! } },
      );
      expect(ex.status, 'frequentlyAccessContacts responds 200').toBe(200);
    });

    test(
      'kmail — contacts status-count read responds',
      { tag: [TAGS.kmail] },
      async ({ endpoints }) => {
        const ex = await endpoints.sendTo(
          'kmail-status-total-count',
          {},
          { label: 'smoke:kmail', auth: { principal: A! } },
        );
        expect(ex.status, 'statusOfKmailsContactsTotalCount responds 200').toBe(200);
      },
    );
  },
);
