// Regression guard for the Katchup filter cross-user leak (KP-818553), confirmed FIXED live
// 2026-10-12: `filterKatchUpMessage` binds the query to the caller's sender/receiver only for a
// recognised `messageBy` value (All/sent/received). An out-of-enum value used to drop that predicate
// and `SELECT *` across EVERY user's messages. The controller now rejects an unknown `messageBy` with
// 400 before the DAO runs. This test pins that behaviour so a regression that re-opens the leak fails.
//
// Read-only (a filter query), so it needs no lifecycle flag — just one KPost principal.

import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

const A = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal');

test.describe(
  'KPost Security · Katchup filter messageBy leak guard @api @kpost-api @security @katchup',
  {
    tag: ['@api', '@katchup', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(!A, 'needs a KPost principal');

    test('an out-of-enum messageBy is refused (400) and never widens the query to all users (KP-818553)', async ({
      endpoints,
    }) => {
      const request = {
        selectedContact: testData.victimKpostId,
        groupFlag: false,
        messageBy: 'ALLUSERS_INJECT',
      };
      const ex = await endpoints.sendTo(
        'katchup-filter-message',
        { body: request },
        { label: 'filter-messageBy-leak-guard', auth: { principal: A! } },
      );

      const body = JSON.parse(ex.bodyText || '{}') as { data?: unknown };
      const rows = Array.isArray(body.data) ? body.data.length : 0;

      // The leak signature: the invalid value was ACCEPTED (2xx) and returned rows (the dropped
      // sender/receiver predicate surfacing other users' messages).
      if (ex.status < 300 && rows > 0) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'katchup-filter-message',
          ruleId: 'KP-818553-MESSAGEBY-ENUM',
          rule:
            'filterKatchUpMessage must reject a messageBy outside {All, sent, received} with a 400; an ' +
            'unrecognised value must never drop the caller sender/receiver predicate and return other ' +
            "users' messages.",
          expected: 'an out-of-enum messageBy is refused with HTTP 400 and returns no rows',
          actual: `the request was accepted (${ex.status}) and returned ${rows} row(s): ${ex.bodyText.slice(0, 300)}`,
          request: { body: request },
        });
      }

      expect(
        ex.status,
        'an invalid messageBy must be refused (400), never silently widened to every user',
      ).toBe(400);
    });
  },
);
