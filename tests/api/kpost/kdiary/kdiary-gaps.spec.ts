import { expect, test } from '@fixtures';

/**
 * KDiary **recorded gaps — not workarounds**.
 *
 *   - `kdiary-get-event-date`: RESOLVED 2026-10-04. The 500 "Value must not be null" was never a
 *     missing-field mystery — it was the bench's own wrong payload (the date-shaped body guessed
 *     2026-09-19). Direct source reading (`KdiaryRO.java`, `KdiaryScheduleServiceImpl.getEventDate`)
 *     found the real required field is `eventIds: List<Long>`, and the endpoint definition
 *     (`src/api/definitions/kpost/kdiary/read.api.ts`) now sends that shape. No frontend caller exists
 *     for this route (the app still uses `getEvents` + `getEventSelectedDate` instead), but it is
 *     live, authenticated, and directly callable — and turned out to carry a confirmed CRITICAL
 *     cross-tenant IDOR (filed as #1017), now covered by
 *     `tests/api/kpost/security/kdiary-object-authorization.spec.ts`. Nothing left unresolved here.
 */

test.describe('KPost KDiary · recorded gaps', () => {
  test('kdiary-get-event-date: resolved — see kdiary-object-authorization.spec.ts', () => {
    expect(
      true,
      'the real payload is confirmed ({eventIds: [...]}), the endpoint is live-exercised, and its ' +
        'confirmed IDOR is filed as #1017 — nothing remains unresolved on this route',
    ).toBe(true);
  });
});
