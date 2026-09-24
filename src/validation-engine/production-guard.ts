import { env } from '@config/env';
import type { ResolvedEndpoint } from './validation-policy';

export class ProductionSafetyError extends Error {
  override readonly name = 'ProductionSafetyError';
}

export interface SafetyFlags {
  isProduction: boolean;
  allowDestructive: boolean;
  /**
   * A caller explicitly authorizes THIS write on the live application. It unlocks a `data`-side-
   * effect destructive endpoint only — `external` (real SMS/email) and `global` (shared state) are
   * never unlocked this way — and the QA-identifier guard still confines it to accounts we own. Set
   * per call by an owner-approved feature spec, never by the engine (so fuzzing stays blocked).
   */
  allowLiveWrite?: boolean;
  /**
   * A caller explicitly authorizes THIS non-destructive "needs-id" read on the live application —
   * the read-side counterpart to `allowLiveWrite`, for a dependency-driven flow that mints a real id
   * (a doc, an attachment, a group image) and then needs to read it back. Scoped identically: `data`-
   * side-effect only (`external`/`global` and OTP stay blocked regardless), the QA-identifier guard
   * still confines it to accounts we own, and it is set per call by an owner-approved feature spec —
   * never by the engine, so its probes and fuzzers stay blocked.
   */
  allowLiveRead?: boolean;
  /**
   * True when requests go to the bundled mock server (`MOCK_API=true`), which cannot send a real
   * SMS/email. False means a real host — where the SMS/OTP kill-switch below applies in EVERY mode.
   */
  mockApi?: boolean;
  /**
   * Deep write-fuzzing on a disposable TEST DB. When both this and `testDbMode` are set, the engine
   * may run its fuzzers on a `data`-side-effect WRITE endpoint (which persists junk — hence test-DB
   * only). It never unlocks `external`/`global`/OTP writes, and the QA-identifier guard stays armed.
   */
  writeFuzz?: boolean;
  /** The target is a throwaway test database (see env `TEST_DB_MODE`); required for `writeFuzz`. */
  testDbMode?: boolean;
  /**
   * The target env's OTP subsystem is a TEST GATEWAY (no real SMS/e-mail; `123456` validates). When
   * set together with `testDbMode`, it lifts the OTP/SMS kill-switch for `otpDependent` endpoints ONLY
   * (see env `OTP_TEST_GATEWAY`), so signup/registration/device/forgot-password/validate flows run on
   * the disposable test DB. Never unlocks a non-`otpDependent` write; the QA-identifier guard stays armed.
   */
  otpTestGateway?: boolean;
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
    mockApi: env.MOCK_API,
    writeFuzz: env.WRITE_FUZZ,
    testDbMode: env.TEST_DB_MODE,
    otpTestGateway: env.OTP_TEST_GATEWAY,
  },
): string | undefined {
  /*
   * ## SMS / OTP kill-switch — the FIRST check, un-bypassable, in EVERY mode
   *
   * An endpoint that delivers a real OTP / SMS / e-mail (`otpDependent`, or `sideEffect: 'external'`)
   * must NEVER be sent to a real host — not on production, not on dev, not on any run — because it
   * costs money and exhausts the SMS gateway. The only safe target is the bundled mock. No flag
   * (`allowDestructive`, `allowLiveWrite`, a wrong `TEST_ENV`) can unlock it. This sits above every
   * other check so nothing downstream can reach an SMS sender against a real host.
   */
  const realHost = !endpoint.mockFixture && flags.mockApi !== true;
  // A path/label backstop: even if an endpoint were mis-flagged (no `otpDependent`/`external`), any
  // OTP / SMS / send-code / forgot-password path is caught here so it can NEVER send against a real host.
  const looksLikeSmsSender = /otp|sms|sendcode|forgotpassword|sentkpostidsms/i.test(endpoint.label);
  const isOtpFlow = Boolean(endpoint.otpDependent) || looksLikeSmsSender;
  /*
   * A few `otpDependent` writes would destroy the RUNNING session — deactivate our own account, or
   * displace it by re-designating the primary device. Blind engine fuzzing of those on `kpost:deep`
   * would break the run (every later login fails) and, for deactivate, take the QA account offline.
   * So they stay blocked even on the test gateway; a deliberate lifecycle on a throwaway account is
   * the right way to exercise them, not the fuzzer. (Secondary-device + registration are fine.)
   */
  const isSessionDestroyer =
    /deactivat|delete\s*account|close\s*account|setdeviceasprimary|updatedeviceasprimary/i.test(
      endpoint.label,
    );
  /*
   * ## TEST-GATEWAY unlock for the OTP flows
   *
   * On a disposable test DB whose OTP subsystem is a CONFIRMED test gateway (`OTP_TEST_GATEWAY=true`,
   * no real SMS/e-mail, `123456` validates), the OTP flows are opened end to end — signup, registration,
   * device designation, forgot-password, validate. It requires BOTH flags (`otpTestGateway` AND
   * `testDbMode`, the disposable-DB contract, exactly like WRITE_FUZZ) and opens ONLY `otpDependent` /
   * SMS endpoints (never a session-destroyer, never a non-OTP `external`/`global` write). The
   * QA-identifier guard is a SEPARATE control and stays armed, so every id is still confined to us.
   */
  const otpTestAuthorized =
    flags.otpTestGateway === true && flags.testDbMode === true && isOtpFlow && !isSessionDestroyer;

  if (
    realHost &&
    (endpoint.otpDependent || endpoint.sideEffect === 'external' || looksLikeSmsSender) &&
    !otpTestAuthorized
  ) {
    return `${endpoint.label}: sends a real OTP/SMS/e-mail — BLOCKED against any real host (SMS kill-switch); it may run only against the bundled mock or a confirmed test gateway (OTP_TEST_GATEWAY+TEST_DB_MODE)`;
  }
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

  /*
   * A `data` write the caller has explicitly authorized for this run (an owner-approved feature
   * spec). It bypasses the `productionSafe` gate below but nothing else: `external`/`global` stay
   * blocked by the side-effect check further down, and the QA-identifier guard still confines the
   * payload to accounts we own. The engine never sets this, so its probes remain blocked.
   */
  const liveWriteAuthorized =
    isLive &&
    flags.allowLiveWrite === true &&
    endpoint.destructive === true &&
    (endpoint.sideEffect ?? 'data') === 'data';

  /*
   * The read-side counterpart, for a "needs-id" read fed a real id a lifecycle flow just minted
   * (e.g. reading back a group image right after uploading it). `destructive !== true` rather than
   * requiring it false: a read is never destructive, so this simply excludes writes, which have
   * their own authorization above. `external`/`global` reads still fall through to the side-effect
   * check below unauthorized, exactly like an unauthorized write would.
   */
  const liveReadAuthorized =
    isLive &&
    flags.allowLiveRead === true &&
    endpoint.destructive !== true &&
    (endpoint.sideEffect ?? 'data') === 'data';

  /*
   * Deep write-fuzzing on a disposable TEST DB. Lets the ENGINE run a `data`-side-effect destructive
   * write (so its fuzzers/attack probes exercise the write's input validation) — which persists junk,
   * so it requires BOTH `writeFuzz` and `testDbMode`. It opens ONLY `data` writes: `external` (SMS/
   * account provisioning) is still blocked by the kill-switch above and the side-effect check below,
   * `global` by the side-effect check, OTP by the OTP check — and the QA-identifier guard still
   * confines every id to accounts we own. Never set against a shared/real database.
   */
  const writeFuzzAuthorized =
    isLive &&
    flags.writeFuzz === true &&
    flags.testDbMode === true &&
    endpoint.destructive === true &&
    (endpoint.sideEffect ?? 'data') === 'data';

  if (
    isLive &&
    !endpoint.productionSafe &&
    !liveWriteAuthorized &&
    !liveReadAuthorized &&
    !writeFuzzAuthorized &&
    !otpTestAuthorized
  ) {
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
  if (isLive && endpoint.otpDependent && !otpTestAuthorized) {
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
    // The OTP/signup flows (external/global) are authorized on the disposable test gateway above.
    if (sideEffect !== 'data' && !otpTestAuthorized) {
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
