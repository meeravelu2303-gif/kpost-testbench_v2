import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { text } from '@database/kpost-assertions';
import { KpostRepository } from '@database/repositories/kpost.repository';
import { requireAll } from '@fixtures/test-accounts';
import { runSimultaneously } from '@utils/concurrency';
import { expect, test } from '@fixtures';

/**
 * Sessions, concurrency and rate limiting — the behaviours that only appear under simultaneous load.
 *
 * ## Why `TBL_KPOST_LOGIN_SESSION` is the subject
 *
 * A session row is what makes a token *revocable*. Everything below reduces to one question the API
 * cannot answer about itself: does the server's record of who is signed in match what it has handed
 * out? Three ways that goes wrong, each invisible from a response:
 *
 *  - Tokens issued with **no row** — "log out from all devices" then silently does nothing.
 *  - Rows that **accumulate without limit** — a device cap that is documented but not enforced.
 *  - Rows belonging to **another account** — the session table is the one place a cross-account
 *    mix-up would be visible before it becomes a data breach.
 *
 * ## What this deliberately does NOT assert
 *
 * A specific device limit. The bench has no documented threshold for KPost, and inventing one
 * ("expect exactly 3") would produce a test that fails on a correct product or passes on a broken
 * one. What it asserts instead is the *invariant* — every row belongs to the account that signed
 * in, and each carries what a revocation needs — plus the observed count, reported for a human.
 * Where a real limit is confirmed, the count assertion tightens in one line.
 *
 * ## Safety
 *
 * Logins only: no writes, no destructive calls. The one genuine risk on a shared QA account is
 * **lockout**, so the wrong-password probe sends exactly ONE bad attempt and is followed by a good
 * login — the precaution the bench already documents for live accounts.
 */
test.describe('KPost Security · sessions and concurrency @api @kpost-api @signup-login', () => {
  const accounts = requireAll('primary');
  test.skip(!accounts.ok, accounts.ok ? '' : accounts.reason);

  const me = (): string => (accounts.ok ? (accounts.accounts[0]?.kpostId ?? '') : '');

  test('every live session row belongs to the account that signed in', async ({ databases }) => {
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection');

    const sessions = await new KpostRepository(database).sessions(me());

    /*
     * The invariant, not a count. A row attributed to somebody else is the single most serious
     * fault this table can show, and unlike a device-limit question it needs no documented
     * threshold to judge.
     */
    expect(
      sessions.every((s) => text(s.kpost_id) === me()),
      `every row returned for ${me()} must belong to it`,
    ).toBe(true);

    for (const session of sessions) {
      expect(session.session_id, 'each session carries the id a revocation needs').toBeTruthy();
      expect(session.login_time, 'and the time it began').toBeTruthy();
    }

    test.info().annotations.push({
      type: 'observed',
      description:
        `${sessions.length} live session row(s) for ${me()}. No device limit is documented for ` +
        `KPost, so the count is reported rather than asserted — tighten this when one is confirmed.`,
    });
  });

  test('simultaneous logins each produce their own revocable session', async ({
    endpoints,
    databases,
  }) => {
    /*
     * Bugzilla #496 is open here: ~60% of simultaneous logins answer 500, though the same login
     * succeeds every time sequentially.
     *
     * Deliberately NOT pinned with `test.fail()`. That inverts the verdict and so demands the
     * defect fire on every run — but this one is a race, and a race that happens not to trigger
     * would be reported as "expected to fail but passed", turning the whole bench red on a coin
     * toss. (Observed exactly that: the same spec reported failed in a long run and passed three
     * times in isolation, with no change in between.)
     *
     * What is asserted instead is the part that must hold whether or not the race fires — no
     * session is ever attributed to another account, and no two sessions share an id. The 5xx rate
     * is measured and reported rather than asserted, and the companion test below is what flags
     * the day the race stops happening.
     */
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection');
    test.skip(!testData.password, 'needs QA_PASSWORD');

    const repo = new KpostRepository(database);
    const before = await repo.sessions(me());

    /*
     * Three logins released from the same tick — the multi-device case. Dispatched together rather
     * than in sequence because the fault being looked for is a race: two logins writing the same
     * session row, or one overwriting the other's, which a sequential loop cannot reproduce.
     *
     * Each carries its own `sessionID`; the bench learned the hard way that a fixed one makes the
     * server invalidate previously issued tokens (see the note on DEVICE in auth-profile.ts).
     */
    const profile = AUTH_PROFILES.kpost;
    const principal = profile.principals[0];
    test.skip(!principal, 'no KPost principal configured');

    const burst = await runSimultaneously(3, async (index) => {
      const exchange = await endpoints.sendTo(
        'signup-login-user-login',
        profile.loginRequest(principal!),
        { label: `security-session:concurrent-login#${index + 1}` },
      );
      return exchange.status;
    });

    const statuses = burst.outcomes.flatMap((o) => (o.value === undefined ? [] : [o.value]));
    expect(statuses.length, 'all three logins completed').toBe(3);
    /*
     * Every login is answered — that is the floor, and it holds even while #496 is open, because
     * the defect is a 500 response rather than a hang or a dropped connection. A request that never
     * comes back is a different and worse fault, so it is asserted here rather than folded into the
     * rate below.
     */

    const after = await repo.sessions(me());

    // The invariant again, now under concurrency: no row may be attributed elsewhere.
    expect(
      after.every((s) => text(s.kpost_id) === me()),
      'concurrent logins did not attribute a session to another account',
    ).toBe(true);

    // Session ids must stay distinct — two devices sharing one row means one cannot be revoked.
    const ids = after.map((s) => text(s.session_id));
    expect(new Set(ids).size, 'every session row has a distinct session_id').toBe(ids.length);

    test.info().annotations.push({
      type: 'observed',
      description:
        `sessions ${before.length} → ${after.length} after 3 simultaneous logins ` +
        `(dispatch skew ${burst.dispatchSkewMs}ms). Statuses: ${statuses.join(', ')}. ` +
        `${statuses.filter((s) => s >= 500).length}/3 answered 5xx — Bugzilla #496.`,
    });
  });

  test('the login burst still reproduces Bugzilla #496, and nothing worse', async ({
    endpoints,
  }) => {
    test.skip(!testData.password, 'needs QA_PASSWORD');
    const profile = AUTH_PROFILES.kpost;
    const principal = profile.principals[0];
    test.skip(!principal, 'no KPost principal configured');

    /*
     * Login is the one endpoint worth probing this way: it is unauthenticated, it is the front door,
     * and it is where a missing rate limit is exploitable. Kept to five per pass — enough to show
     * whether a limit exists at all, small enough not to lock the account or degrade a shared
     * environment.
     *
     * Every request uses the CORRECT password. A burst of wrong passwords is how a test bench locks
     * its own account and stops every other module.
     *
     * THREE passes, not one, because #496 is probabilistic. A single burst that happens to come
     * back clean proves nothing, and pinning the test to a single outcome makes the bench flap. The
     * bench already uses a 3-pass gate before filing a defect; the same standard is applied to
     * deciding a defect has stopped reproducing.
     */
    const statuses: number[] = [];
    for (let pass = 0; pass < 3; pass += 1) {
      const burst = await runSimultaneously(5, async (index) => {
        const exchange = await endpoints.sendTo(
          'signup-login-user-login',
          profile.loginRequest(principal!),
          { label: `security-session:login-burst-p${pass + 1}#${index + 1}` },
        );
        return exchange.status;
      });
      statuses.push(...burst.outcomes.flatMap((o) => (o.value === undefined ? [] : [o.value])));
    }

    const serverErrors = statuses.filter((s) => s >= 500);
    const throttled = statuses.filter((s) => s === 429);

    /*
     * Every request must be ANSWERED. A 500 is the known defect; a request that never returns is a
     * different fault, and one this assertion would catch.
     */
    expect(statuses.length, 'all 15 logins were answered').toBe(15);

    /*
     * The direction of this assertion is the point. While #496 is open the burst is EXPECTED to
     * produce 5xx, so demanding zero would leave the bench permanently red on a known, filed defect.
     * What is asserted instead is that the defect still behaves as filed — and the moment it stops
     * reproducing across all three passes, this fails and says so, which is the signal to re-verify
     * and close #496 rather than let a fixed ticket sit open indefinitely.
     */
    expect(
      serverErrors.length,
      `Bugzilla #496 did not reproduce: 15/15 simultaneous logins succeeded across 3 passes ` +
        `(statuses: ${statuses.join(', ')}). If this holds, the defect is fixed — re-verify and ` +
        `close the ticket, then change this assertion to require zero 5xx.`,
    ).toBeGreaterThan(0);

    test.info().annotations.push({
      type: 'observed',
      description:
        `${serverErrors.length}/15 answered 5xx across 3 passes of 5 simultaneous logins ` +
        `(Bugzilla #496). ` +
        (throttled.length > 0
          ? `${throttled.length}/15 throttled with 429 — a rate limit is enforced on login.`
          : `0/15 throttled — login applies NO rate limit at this burst size. Not asserted as a ` +
            `defect (no documented policy), but worth a product decision: this is the front door.`),
    });
  });
});
