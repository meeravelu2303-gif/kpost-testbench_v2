import { env } from '@config/env';
import { isLiveHost } from '@config/live-hosts';
import type { ResolvedEndpoint } from './validation-policy';

/** Whether any configured host is a live KPost host (then no shared-state write may run). */
export const LIVE_HOST_CONFIGURED = [
  env.BASE_URL,
  env.API_BASE_URL,
  env.KPOST_API_BASE_URL,
  env.KMAIL_API_BASE_URL,
  env.ADMIN_API_BASE_URL,
].some((url) => Boolean(url) && isLiveHost(new URL(url!).hostname));

export class ProductionSafetyError extends Error {
  override readonly name = 'ProductionSafetyError';
}

export interface SafetyFlags {
  isProduction: boolean;
  allowDestructive: boolean;
  /** Per-call authorization of one live `data` write by a feature spec; never set by the engine. */
  allowLiveWrite?: boolean;
  /** Per-call authorization of one live read of an id the flow just minted; never the engine. */
  allowLiveRead?: boolean;
  /** The request names an account/mobile that does not exist, so an SMS sender texts nobody. */
  noSmsRecipient?: boolean;
  /** With `testDbMode`, lets the engine fuzz `data` writes (they persist junk, so test DB only). */
  writeFuzz?: boolean;
  /** The target is a throwaway test database (see env `TEST_DB_MODE`); required for `writeFuzz`. */
  testDbMode?: boolean;
  /** OTP is a test gateway (`123456` validates); with `testDbMode` it opens the OTP endpoints. */
  otpTestGateway?: boolean;
  /**
   * Env `GLOBAL_LIFECYCLE`: the target is the QA test server, so self-cleaning flows may make
   * shared-state (`global`) writes. Unlocks nothing without a per-call `allowGlobalLifecycle`.
   */
  globalLifecycle?: boolean;
  /** Per-call authorization of one `global` write by a self-cleaning flow; never the engine. */
  allowGlobalLifecycle?: boolean;
  /** Some configured host is a live one: `globalLifecycle` then unlocks nothing. */
  liveHostConfigured?: boolean;
  /**
   * The call acts on a throwaway account its own flow created this run, signed in as that account
   * (the executor checks both). With the OTP test gateway on the test DB, it may run what would end
   * or damage a real account — device changes, password and access-code changes, deactivation.
   * Never a real-SMS sender: those rules come first.
   */
  throwawayAccount?: boolean;
}

/** The only accounts `throwawayAccount` may name: created and deleted by one flow run. */
export const THROWAWAY_ACCOUNT_ID = /^apiflowkpost\d{1,2}@kpostindia\.com$/;

/**
 * How far outside the test's own data an endpoint reaches: `data` (records the tests own, the
 * default), `external` (texts or mails a real person), `global` (state shared by everyone, e.g. the
 * app version). `external` and `global` are blocked on every environment unless
 * `ALLOW_DESTRUCTIVE_TESTS=true`.
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
};

const OTP_REASONS: Record<NonNullable<GuardedEndpoint['otpDependent']>, string> = {
  sends: 'sends a real OTP to a real phone or mailbox',
  consumes: 'needs a real OTP in its payload, and production has no bypass',
  requires: 'needs an OTP validated in an earlier step, and production has no bypass',
};

/**
 * Why an endpoint must not be called, or undefined when it may be. Enforced in the executor, so
 * setup calls and probes are covered too. Checks run in severity order; on live `allowDestructive`
 * unlocks nothing.
 */
export function destructiveBlockReason(
  endpoint: GuardedEndpoint,
  flags: SafetyFlags = {
    isProduction: env.IS_PRODUCTION,
    allowDestructive: env.ALLOW_DESTRUCTIVE_TESTS,
    writeFuzz: env.WRITE_FUZZ,
    testDbMode: env.TEST_DB_MODE,
    otpTestGateway: env.OTP_TEST_GATEWAY,
    globalLifecycle: env.GLOBAL_LIFECYCLE,
    liveHostConfigured: LIVE_HOST_CONFIGURED,
  },
): string | undefined {
  /*
   * SMS/OTP kill-switch, first and in every mode: a real OTP/SMS/e-mail costs money and exhausts
   * the gateway. Only a confirmed test gateway unlocks it. The label regex catches a mis-flagged
   * endpoint.
   */
  const looksLikeSmsSender = /otp|sms|sendcode|forgotpassword|sentkpostidsms/i.test(endpoint.label);
  const isOtpFlow = Boolean(endpoint.otpDependent) || looksLikeSmsSender;
  // Deactivate / re-designate-primary would end the running session: blocked even on the gateway.
  const isSessionDestroyer =
    /deactivat|delete\s*account|close\s*account|setdeviceasprimary|updatedeviceasprimary|logoutfromalldevices/i.test(
      endpoint.label,
    );
  // The test-gateway unlock needs both `otpTestGateway` and `testDbMode`, and opens OTP flows only.
  const onTestGateway = flags.otpTestGateway === true && flags.testDbMode === true;
  // Ending a session or deactivating is fine on a throwaway account the flow itself created.
  const throwawayAuthorized = onTestGateway && flags.throwawayAccount === true;
  const otpTestAuthorized =
    onTestGateway && isOtpFlow && (!isSessionDestroyer || throwawayAuthorized);

  if (
    (endpoint.otpDependent || endpoint.sideEffect === 'external' || looksLikeSmsSender) &&
    !otpTestAuthorized
  ) {
    return `${endpoint.label}: sends a real OTP/SMS/e-mail — BLOCKED (SMS kill-switch); it may run only against a confirmed test gateway (OTP_TEST_GATEWAY+TEST_DB_MODE)`;
  }
  /*
   * forgotPassword ignores the OTP bypass and texts a real phone on every host. The one such SMS
   * per run belongs to the browser lifecycle, so API calls need `noSmsRecipient`.
   */
  if (
    /forgotpassword/i.test(endpoint.label) &&
    endpoint.otpDependent === 'sends' &&
    !flags.noSmsRecipient
  ) {
    return `${endpoint.label}: texts a real phone even on the test gateway (forgotPassword ignores the OTP bypass) — BLOCKED; the one forgot-password SMS per run belongs to the browser lifecycle test`;
  }
  /*
   * The profile's device and deactivation OTP senders also ignore the bypass: each mints a random code
   * and calls the SMS gateway for the account's own mobile (UserProfileServiceImpl.java:360-410,
   * SignUpLoginServiceImpl.java:1003-1039). Flows get the same OTP type SMS-free through
   * common/sendOTP, which honours the bypass.
   */
  if (
    /sendPrimaryDeviceOtp|sendPrimaryOrSecondaryDeviceOtp|sendAccountDeactivationOtp/i.test(
      endpoint.label,
    ) &&
    endpoint.otpDependent === 'sends'
  ) {
    return `${endpoint.label}: texts the account's real phone even on the test gateway (the device and deactivation OTP senders ignore the OTP bypass) — BLOCKED; flows use common/sendOTP with the same OTP type instead`;
  }
  // After every real-SMS rule: the throwaway account's own calls may run whatever they need.
  if (throwawayAuthorized) return undefined;
  /*
   * A self-cleaning flow's shared-state (`global`) write on the QA test server: GLOBAL_LIFECYCLE and
   * TEST_DB_MODE, the call's own allowGlobalLifecycle, and no live host configured. The engine never
   * sets the per-call flag; real SMS/e-mail were refused above; ending a session needs the throwaway.
   */
  if (
    flags.isProduction &&
    flags.globalLifecycle === true &&
    flags.testDbMode === true &&
    flags.allowGlobalLifecycle === true &&
    flags.liveHostConfigured !== true &&
    endpoint.destructive === true &&
    endpoint.sideEffect === 'global' &&
    !isSessionDestroyer
  ) {
    return undefined;
  }
  /*
   * Live default deny: blocked unless `productionSafe: true`, since a delete on a real record is
   * irreversible. An allowlist, because a blocklist admits every endpoint nobody has thought about.
   */
  const isLive = flags.isProduction;

  // An explicitly authorized `data` write bypasses only the productionSafe gate.
  const liveWriteAuthorized =
    isLive &&
    flags.allowLiveWrite === true &&
    endpoint.destructive === true &&
    (endpoint.sideEffect ?? 'data') === 'data';

  // The read-side counterpart, for reading back an id a lifecycle flow just minted.
  const liveReadAuthorized =
    isLive &&
    flags.allowLiveRead === true &&
    endpoint.destructive !== true &&
    (endpoint.sideEffect ?? 'data') === 'data';

  // Write-fuzzing on a disposable test DB opens `data` writes only.
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

  // OTP-dependent endpoints are skipped on live: a missing-OTP 400 is a precondition, not a bug.
  if (isLive && endpoint.otpDependent && !otpTestAuthorized) {
    return `${endpoint.label} ${OTP_REASONS[endpoint.otpDependent]}`;
  }

  if (!endpoint.destructive) return undefined;

  // ALLOW_DESTRUCTIVE_TESTS grants nothing on live (too easy to inherit by accident), and says so.
  const sideEffect = endpoint.sideEffect ?? 'data';

  if (isLive) {
    // The OTP/signup flows (external/global) are authorized on the disposable test gateway above.
    if (sideEffect !== 'data' && !otpTestAuthorized) {
      return (
        `${endpoint.label} ${REASONS[sideEffect]} and TEST_ENV=production ` +
        `(ALLOW_DESTRUCTIVE_TESTS does not apply to the live application)`
      );
    }
    // A cleared live `data` write is safe only because the identifier guard checks every id.
    return undefined;
  }

  if (flags.allowDestructive) return undefined;

  if (sideEffect !== 'data') {
    return `${endpoint.label} ${REASONS[sideEffect]} (set ALLOW_DESTRUCTIVE_TESTS=true to run it)`;
  }
  // A plain `data` write off live needs no flag.
  return undefined;
}
