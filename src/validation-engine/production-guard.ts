import { env } from '@config/env';
import type { ResolvedEndpoint } from './validation-policy';

export class ProductionSafetyError extends Error {
  override readonly name = 'ProductionSafetyError';
}

export interface SafetyFlags {
  isProduction: boolean;
  allowDestructive: boolean;
}

/**
 * How far outside the test's own data an endpoint reaches.
 *
 * `destructive` alone was too blunt. It blocked writes on production and allowed them everywhere
 * else, which is right for creating a throwaway user — and wrong for the three kinds of call below,
 * where a "dev" environment is no safer than production:
 *
 *   `data`      creates or changes records the tests own. Safe off production. The default.
 *   `external`  sends something to a real person: an SMS, an email. Costs money, annoys humans,
 *               and trips carrier rate limits that then break every later test.
 *   `global`    changes state shared by everyone on the environment: the mobile app version every
 *               client is told to install, or another account's password.
 *
 * `external` and `global` are blocked on **every** environment unless `ALLOW_DESTRUCTIVE_TESTS=true`,
 * so running the suite cannot text somebody by accident. Turning the flag on is a deliberate act;
 * the endpoints are fully tested when it is.
 */
export type SideEffect = 'data' | 'external' | 'global';

const REASONS: Record<Exclude<SideEffect, 'data'>, string> = {
  external: 'sends a real SMS or email',
  global: 'changes state shared by the whole environment',
};

/** What the guard needs to know about an endpoint. Kept structural so tests can pass a literal. */
export type GuardedEndpoint = Pick<ResolvedEndpoint, 'destructive' | 'label'> & {
  sideEffect?: SideEffect;
  productionSafe?: boolean;
  otpDependent?: 'sends' | 'consumes' | 'requires';
  /** The bench's own fixture, always served by `mock-server/` — it cannot reach the live API. */
  mockFixture?: boolean;
};

const OTP_REASONS: Record<NonNullable<GuardedEndpoint['otpDependent']>, string> = {
  sends: 'sends a real OTP to a real phone or mailbox',
  consumes: 'needs a real OTP in its payload, and production has no bypass',
  requires: 'needs an OTP validated in an earlier step, and production has no bypass',
};

/**
 * Reason an endpoint must not be called at all, or undefined when it may be.
 *
 * Enforced inside the executor, so setup calls and probes are covered too — not just tests. The
 * order of the checks below is the order of severity, and it matters: the production allowlist is
 * consulted **before** `allowDestructive`, because on the live application that flag must not be
 * able to unlock anything.
 */
export function destructiveBlockReason(
  endpoint: GuardedEndpoint,
  flags: SafetyFlags = {
    isProduction: env.IS_PRODUCTION,
    allowDestructive: env.ALLOW_DESTRUCTIVE_TESTS,
  },
): string | undefined {
  /*
   * ## On the live application, default deny
   *
   * Every endpoint is blocked unless its definition says `productionSafe: true`. This is checked
   * first and cannot be overridden by any environment variable, because the failure it prevents is
   * irreversible: a delete against a real customer's record.
   *
   * A blocklist would have been less code and is the wrong shape — it admits every endpoint nobody
   * has thought about yet, which is exactly the set most likely to be dangerous.
   */
  /*
   * A mock fixture is never "live", whatever TEST_ENV says: the executor routes it to the bundled
   * mock server's base URL, so it physically cannot reach the live application. Without this the
   * live rules below would block the bench's own self-tests — the suite that proves the engine
   * works — and a run configured for live would report nothing at all, including about itself.
   */
  const isLive = flags.isProduction && !endpoint.mockFixture;

  if (isLive && !endpoint.productionSafe) {
    return (
      `${endpoint.label} is not cleared for the live application ` +
      `(no productionSafe flag — see src/api/registry/endpoint-definition.ts)`
    );
  }

  /*
   * ## OTP-dependent endpoints cannot work on live, and trying costs something
   *
   * Skipped rather than failed: a 400 from a missing OTP is a known precondition, not a defect,
   * and 16 endpoints reporting it would bury the findings that matter. `sends` is blocked for the
   * opposite reason — it *would* succeed, and deliver a real message.
   */
  if (isLive && endpoint.otpDependent) {
    return `${endpoint.label} ${OTP_REASONS[endpoint.otpDependent]} (npm run contract:otp)`;
  }

  if (!endpoint.destructive) return undefined;

  /*
   * ## `ALLOW_DESTRUCTIVE_TESTS` is refused outright on the live application
   *
   * Off production it is a useful switch: it lets a deliberate run exercise registration and the
   * OTP senders. On production the endpoints it unlocks are precisely the ones that must never run
   * unattended — `forgotPasswordUpdate`, `removeCompanyLogo`, `updateFlutterAppVersion` — and an
   * environment variable is far too easy to inherit from a shell, a CI job or a stale `.env`.
   *
   * So on production the flag grants nothing, and saying so explicitly is better than appearing to
   * work: somebody who sets it needs to learn that it did not take effect.
   */
  const sideEffect = endpoint.sideEffect ?? 'data';

  if (isLive) {
    if (sideEffect !== 'data') {
      return (
        `${endpoint.label} ${REASONS[sideEffect]} and TEST_ENV=production ` +
        `(ALLOW_DESTRUCTIVE_TESTS does not apply to the live application)`
      );
    }
    /*
     * A `data` write on the live application is allowed only for an endpoint already cleared
     * above, and only because the QA-identifier guard has verified every id in its payload belongs
     * to us. Without that guard this branch would be the hole in the whole scheme.
     */
    return undefined;
  }

  if (flags.allowDestructive) return undefined;

  if (sideEffect !== 'data') {
    return `${endpoint.label} ${REASONS[sideEffect]} (set ALLOW_DESTRUCTIVE_TESTS=true to run it)`;
  }
  /*
   * A plain `data` write off the live application needs no flag — that is what a test-owned record
   * is for. The pre-`mockFixture` guard also blocked these whenever TEST_ENV=production, which is
   * now redundant: a non-fixture endpoint on production was already stopped by the allowlist at the
   * top, and a fixture on production writes only to the bundled mock. Keeping that rule here would
   * mean the framework's own self-tests could not run while the bench is configured for live —
   * losing the ability to verify the engine at exactly the moment it matters most.
   */
  return undefined;
}
