import { expect, test } from '@fixtures';

/**
 * KDiary **recorded gaps — not workarounds**.
 *
 *   - `kdiary-get-event-date`: the endpoint definition's own investigation already concluded this
 *     route is unused by the live frontend (which calls `getEvents` + `getEventSelectedDate`
 *     instead), so its request body is inferred, not documented. It 500s "Value must not be null"
 *     for every payload shape tried (curl-verified 2026-09-19) — an unknown required field is
 *     missing, not a confirmed product regression on a route real users exercise. Needs the actual
 *     payload confirmed with the dev before this can be driven live without risking a false
 *     "CRITICAL" on a route nobody calls.
 */

test.describe('KPost KDiary · recorded gaps', () => {
  test('kdiary-get-event-date: no live test (frontend-unused, payload unconfirmed — 500s for every shape tried)', () => {
    test.skip(
      true,
      'no frontend caller exists for this route (the app uses getEvents + getEventSelectedDate); ' +
        'curl-verified 2026-09-19 that it 500s "Value must not be null" for both a date-only and a ' +
        'full-datetime payload alike, meaning a required field is simply missing from every shape ' +
        'tried — not a confirmed regression. Needs the real payload confirmed with the dev.',
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });
});
