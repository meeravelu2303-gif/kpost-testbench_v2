import { pruneTokenHistory, type StoredToken } from '@engine/token-history';
import { expect, test } from '@fixtures';

/**
 * The expired-token check needs a QA token from an earlier run that has aged past its `exp`. Before
 * 2026-10-20 the history kept only the newest 20, so one busy day pushed every older token out and the
 * check skipped for ever. These pin the fix: each account keeps the token that matures first, and its
 * newest already-expired one, whatever the volume.
 */
const DAY = 24 * 3600;

function jwt(sub: string, exp: number): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'HS256' })}.${part({ sub, exp })}.sig`;
}
const entry = (sub: string, recordedAt: number): StoredToken => ({
  token: jwt(sub, recordedAt + DAY),
  exp: recordedAt + DAY,
  recordedAt,
});

test.describe('token history @framework', { tag: ['@framework'] }, () => {
  test('a busy day cannot push out the token that will expire first', () => {
    const now = 1_000_000_000;
    const early = entry('qatest1@kpostindia.com', now - 3 * 3600);
    const busyDay = Array.from({ length: 40 }, (_, i) =>
      entry('qatest1@kpostindia.com', now - 60 + i),
    );
    const kept = pruneTokenHistory([early, ...busyDay], now);
    expect(kept, 'the oldest live token survives 40 newer ones').toContainEqual(early);
    expect(kept.length, 'still bounded: newest 20 + one per account').toBeLessThanOrEqual(21);
  });

  test('an already-expired token is kept, so the check can run', () => {
    const now = 2_000_000_000;
    const aged = entry('qatest1@kpostindia.com', now - 2 * DAY); // exp = now - DAY → expired
    const today = Array.from({ length: 30 }, (_, i) =>
      entry('qatest1@kpostindia.com', now - 100 + i),
    );
    const kept = pruneTokenHistory([aged, ...today], now);
    expect(kept, 'the expired one is still there').toContainEqual(aged);
  });

  test('nothing older than 14 days is kept', () => {
    const now = 3_000_000_000;
    const ancient = entry('qatest1@kpostindia.com', now - 15 * DAY);
    expect(pruneTokenHistory([ancient], now)).toEqual([]);
  });
});
