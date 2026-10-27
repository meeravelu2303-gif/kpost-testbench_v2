import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { text } from '@database/kpost-assertions';
import { KpostRepository } from '@database/repositories/kpost.repository';
import { requireAll } from '@fixtures/test-accounts';
import { runSimultaneously } from '@utils/concurrency';
import { expect, test } from '@fixtures';

/**
 * Login sessions under simultaneous logins, checked on `TBL_KPOST_LOGIN_SESSION`: every row belongs
 * to the account and is revocable. No device limit is documented, so the count is only reported.
 * Logins only, always with the correct password.
 */
test.describe(
  'KPost Security · sessions and concurrency @api @kpost-api @signup-login @database',
  {
    tag: ['@api', '@auth', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    const accounts = requireAll('primary');
    test.skip(!accounts.ok, accounts.ok ? '' : accounts.reason);

    const me = (): string => (accounts.ok ? (accounts.accounts[0]?.kpostId ?? '') : '');

    test('every live session row belongs to the account that signed in', async ({ databases }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection');

      const sessions = await new KpostRepository(database).sessions(me());

      // The invariant, not a count: a row attributed to someone else is the serious fault.
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
      // Asserts what must hold whether or not the #496 login race fires (no foreign rows, distinct
      // ids). The 5xx rate is only reported; the next test asserts it.
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection');
      test.skip(!testData.password, 'needs QA_PASSWORD');

      const repo = new KpostRepository(database);
      const before = await repo.sessions(me());

      // Three logins from one tick (the multi-device case), each with its own `sessionID`: a fixed
      // one makes the server invalidate earlier tokens.
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
      expect(statuses, 'all three logins completed').toHaveLength(3);

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

    test('a login burst produces no 5xx (Bugzilla #496, fixed and verified 2026-10-03)', async ({
      endpoints,
    }) => {
      test.skip(!testData.password, 'needs QA_PASSWORD');
      const profile = AUTH_PROFILES.kpost;
      const principal = profile.principals[0];
      test.skip(!principal, 'no KPost principal configured');

      // Three passes of five simultaneous logins, correct password only (wrong ones lock the
      // account). Three passes because the #496 race is probabilistic.
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

      expect(statuses, 'all 15 logins were answered').toHaveLength(15);

      // Regression guard for #496: any 5xx here means the login race came back.
      expect(
        serverErrors,
        `Bugzilla #496 regressed: ${serverErrors.length}/15 simultaneous logins answered 5xx across ` +
          `3 passes (statuses: ${statuses.join(', ')}). This was fixed and verified 2026-10-03 — a ` +
          `failure here means it came back.`,
      ).toHaveLength(0);

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
  },
);
