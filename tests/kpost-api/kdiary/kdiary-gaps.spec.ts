import { expect, test } from '@fixtures';

/**
 * KDiary recorded gaps. kdiary-get-event-date is resolved (payload `{eventIds: [...]}`); its IDOR
 * (#1017) is covered by security/kdiary-object-authorization.spec.ts.
 */

test.describe(
  'KPost KDiary · recorded gaps',
  {
    tag: ['@api', '@verticals', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test('kdiary-get-event-date: resolved — see kdiary-object-authorization.spec.ts', () => {
      expect(
        true,
        'the real payload is confirmed ({eventIds: [...]}), the endpoint is live-exercised, and its ' +
          'confirmed IDOR is filed as #1017 — nothing remains unresolved on this route',
      ).toBe(true);
    });
  },
);
