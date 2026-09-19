import fs from 'node:fs';
import path from 'node:path';
import { apiRegistry } from '@api/definitions/index';
import type { EndpointDefinition } from '@api/registry/endpoint-definition';
import { AUTH_PROFILES } from '@config/auth-profile';
import { ROOT_DIR } from '@config/constants';
import { env } from '@config/env';
import { destructiveBlockReason, type GuardedEndpoint } from '@engine/production-guard';
import {
  PRODUCTION_BLOCKED_VALIDATORS,
  PRODUCTION_SAFE_VALIDATORS,
  productionExclusion,
} from '@engine/production-validators';
import { foreignIdentifiers } from '@engine/qa-identifier-guard';
import { expect, test } from '@fixtures';
import { validationRegistry } from '@validators/index';

/**
 * The live-application safety controls, asserted rather than assumed.
 *
 * Three independent controls stand between this bench and a live customer's data, and each one is
 * a few lines of code that a refactor could quietly neuter:
 *
 *   1. the endpoint allowlist   — only `productionSafe: true` runs
 *   2. the validator allowlist  — nothing that mutates and re-sends a request runs
 *   3. the QA-identifier guard  — no request may name a record we do not own
 *
 * A control nobody tests is a control that works until the day it matters. These run with no HTTP
 * and no environment, so they cannot be skipped for want of a host.
 */
test.describe('live-application safety @framework', () => {
  /*
   * ## Control 1 — the endpoint allowlist
   */
  test('an endpoint without productionSafe is blocked on the live application', () => {
    const endpoint: GuardedEndpoint = { label: 'GET /v2/common/countries', destructive: false };

    const blocked = destructiveBlockReason(endpoint, {
      isProduction: true,
      allowDestructive: false,
    });

    expect(blocked, 'a read-only endpoint with no flag must still be blocked').toContain(
      'not cleared for the live application',
    );
  });

  test('ALLOW_DESTRUCTIVE_TESTS cannot unlock anything on the live application', () => {
    /*
     * The old guard returned early on `allowDestructive`, so this flag unlocked `external` and
     * `global` endpoints everywhere — including production. That is the single most dangerous
     * shape this file exists to prevent: one inherited environment variable and the suite may
     * text real people and overwrite another account's password on live.
     */
    // A non-SMS destructive endpoint: the flag must not bypass the production allowlist.
    const unflagged: GuardedEndpoint = {
      label: 'POST /admin/removeCompanyLogo',
      destructive: true,
    };
    expect(
      destructiveBlockReason(unflagged, { isProduction: true, allowDestructive: true }),
      'the flag must not bypass the production allowlist',
    ).toContain('not cleared for the live application');

    // An external side effect stays blocked on live even when cleared — now via the SMS kill-switch,
    // which supersedes (it fires first for any external/OTP sender against a real host).
    const cleared: GuardedEndpoint = {
      label: 'POST /v2/common/sendOTP/',
      destructive: true,
      sideEffect: 'external',
      productionSafe: true,
    };
    expect(
      destructiveBlockReason(cleared, { isProduction: true, allowDestructive: true }),
      'a real SMS must stay blocked on live even when cleared',
    ).toMatch(/kill-switch/i);
  });

  test('OTP-dependent endpoints are skipped on live with the reason attached', () => {
    for (const kind of ['sends', 'consumes', 'requires'] as const) {
      const endpoint: GuardedEndpoint = {
        label: 'POST /v2/signupLogin/signup/',
        destructive: false,
        productionSafe: true,
        otpDependent: kind,
      };
      expect(
        destructiveBlockReason(endpoint, { isProduction: true, allowDestructive: false }),
        `otpDependent: ${kind} must be blocked on live`,
      ).toMatch(/OTP/);
    }
  });

  test('SMS/OTP kill-switch: an OTP/SMS sender is blocked against a real host in EVERY mode', () => {
    // The endpoints that deliver a real SMS: flagged (otpDependent / external) AND a mis-flagged one
    // caught only by the path/label backstop. Each must be refused against a real host regardless of
    // TEST_ENV or any unlock flag — and allowed only against the bundled mock.
    const senders: GuardedEndpoint[] = [
      { label: 'POST /v2/common/sendOTP/', destructive: true, otpDependent: 'sends' },
      { label: 'POST /v2/common/sendOTPtoMail/', destructive: true, sideEffect: 'external' },
      // mis-flagged on purpose (no otpDependent/external) — only the label backstop catches it:
      { label: 'POST /v2/common/forgotPasswordOTPOrSentKpostIDSms', destructive: true },
    ];
    for (const s of senders) {
      // Real host, every mode + every unlock flag → BLOCKED.
      for (const flags of [
        { isProduction: true, allowDestructive: false, mockApi: false },
        { isProduction: false, allowDestructive: true, mockApi: false }, // NOT production, flag on
        { isProduction: false, allowDestructive: false, mockApi: false, allowLiveWrite: true },
        { isProduction: false, allowDestructive: false, mockApi: undefined }, // mockApi unknown → fail-safe
      ]) {
        expect(
          destructiveBlockReason(s, flags),
          `${s.label} must be blocked against a real host (flags ${JSON.stringify(flags)})`,
        ).toMatch(/kill-switch|OTP|SMS/i);
      }
      // Against the bundled mock the kill-switch does NOT fire (no real SMS is possible there); the
      // request is routed to the mock, so any OTP self-test still works.
      expect(
        destructiveBlockReason(s, { isProduction: false, allowDestructive: true, mockApi: true }) ??
          '',
        `${s.label}: the kill-switch must not fire against the mock`,
      ).not.toMatch(/kill-switch/i);
    }
  });

  test('every registered OTP/SMS sender is blocked against a real host', () => {
    // No definition can slip through: every OTP sender in the real registry is refused on a real host.
    const senders = apiRegistry
      .all()
      .filter((d: EndpointDefinition) => !d.mockFixture)
      .filter((d: EndpointDefinition) => d.otpDependent || d.sideEffect === 'external');
    for (const d of senders) {
      const g: GuardedEndpoint = {
        label: `${d.method} ${d.path}`,
        destructive: d.destructive ?? false,
        productionSafe: d.productionSafe,
        sideEffect: d.sideEffect,
        otpDependent: d.otpDependent,
      };
      expect(
        destructiveBlockReason(g, { isProduction: false, allowDestructive: true, mockApi: false }),
        `${d.method} ${d.path} must be blocked against a real host even off-production`,
      ).toBeDefined();
    }
  });

  test('off production the guard keeps its previous behaviour', () => {
    const dataWrite: GuardedEndpoint = { label: 'POST /x', destructive: true };
    expect(
      destructiveBlockReason(dataWrite, { isProduction: false, allowDestructive: false }),
      'a test-owned data write needs no flag off production',
    ).toBeUndefined();

    // An external SMS endpoint — off production, AGAINST THE MOCK (mockApi:true), the kill-switch does
    // not fire, so the normal side-effect rule applies (gated, unlockable by the flag). Against a real
    // host it is unconditionally blocked by the kill-switch (asserted in the kill-switch test above).
    const sms: GuardedEndpoint = { label: 'POST /x', destructive: true, sideEffect: 'external' };
    expect(
      destructiveBlockReason(sms, { isProduction: false, allowDestructive: false, mockApi: true }),
      'an SMS is still gated off production',
    ).toContain('ALLOW_DESTRUCTIVE_TESTS=true');
    expect(
      destructiveBlockReason(sms, { isProduction: false, allowDestructive: true, mockApi: true }),
      'and the flag still unlocks it off production against the mock',
    ).toBeUndefined();
  });

  /*
   * ## Control 2 — the validator allowlist
   */
  test('every registered validator is classified for the live application', () => {
    const classified = new Set([
      ...PRODUCTION_SAFE_VALIDATORS,
      ...Object.keys(PRODUCTION_BLOCKED_VALIDATORS),
    ]);
    const unclassified = validationRegistry
      .all()
      .map((validator) => validator.name)
      .filter((name) => !classified.has(name));

    /*
     * An unclassified validator is denied at runtime, which is safe but invisible — nobody would
     * learn they need to decide. Failing here is how the decision gets made.
     */
    expect(
      unclassified,
      'classify these in src/validation-engine/production-validators.ts',
    ).toEqual([]);
  });

  test('no validator is in both the safe and blocked lists', () => {
    const both = PRODUCTION_SAFE_VALIDATORS.filter((name) => name in PRODUCTION_BLOCKED_VALIDATORS);
    expect(both, 'a validator cannot be both cleared and blocked').toEqual([]);
  });

  test('no request-mutating validator is cleared for the live application', () => {
    /*
     * The categories whose whole method is "change the request and send it again". If one ever
     * appears in the safe list, the allowlist has been widened past its purpose — most likely by
     * someone chasing coverage on a live run.
     */
    const mutating = PRODUCTION_SAFE_VALIDATORS.filter(
      (name) =>
        name.startsWith('request.') ||
        name.startsWith('authorization.') ||
        [
          'security.injection',
          'security.xss',
          'security.information-disclosure',
          'security.rate-limit',
        ].includes(name) ||
        ['performance.payload-size', 'performance.timeout'].includes(name),
    );
    expect(mutating, 'these send requests no real client would make').toEqual([]);
  });

  test('the injection and cross-tenant validators are excluded on live, read or write', () => {
    // These can never run on live: injection could turn a read into a destructive write, and the
    // cross-tenant/abuse probes target other users or degrade the shared service.
    for (const name of [
      'security.injection',
      'security.xss',
      'security.information-disclosure',
      'security.rate-limit',
      'authorization.cross-resource-access',
      'performance.timeout',
    ]) {
      expect(
        productionExclusion(name, { destructive: false }),
        `${name} blocked on reads`,
      ).toBeTruthy();
      expect(
        productionExclusion(name, { destructive: true }),
        `${name} blocked on writes`,
      ).toBeTruthy();
    }
  });

  test('input-validation fuzzers run on live READS but stay blocked on writes', () => {
    // A read persists nothing and the identifier guard confines every mutation to our own data, so
    // fuzzing a read's input is safe and finds the wrong-handling class (null/type/boundary/…).
    for (const name of [
      'request.null-value',
      'request.data-type',
      'request.boundary-value',
      'request.enum',
      'request.required-fields',
      'request.malformed-json',
      'request.unsupported-media-type',
    ]) {
      expect(
        productionExclusion(name, { destructive: false }),
        `${name} must run on a live read`,
      ).toBeUndefined();
      expect(
        productionExclusion(name, { destructive: true }),
        `${name} must stay blocked on a live write`,
      ).toBeTruthy();
      // Called without an endpoint (the older signature), they stay blocked — safe default.
      expect(productionExclusion(name), `${name} blocked with no endpoint context`).toBeTruthy();
    }
  });

  test('an unknown validator name is denied, not allowed', () => {
    expect(
      productionExclusion('something.nobody-classified-yet'),
      'default deny, with an instruction',
    ).toContain('unclassified validator');
  });

  /*
   * ## Control 3 — the QA-identifier guard
   */
  test('a request naming a company we do not own is rejected', () => {
    // The exact payload the live application uses, with the owner's company id.
    const foreign = foreignIdentifiers({ body: { companyId: 4 } });
    expect(foreign.map((offence) => offence.path)).toEqual(['body.companyId']);
  });

  test('bulk id arrays of tenant identifiers are checked element by element', () => {
    /*
     * A list of another user's kpostIDs — the shape `removeGroupMember` / `modifyKallMembers` take —
     * is checked element by element, so a fuzzer cannot slip a stranger's account into one element.
     */
    const foreign = foreignIdentifiers({
      body: { addingUserIds: ['jitendra9@kpostindia.com', 'limson@kpostindia.com'] },
    });
    expect(foreign.map((offence) => offence.path)).toEqual([
      'body.addingUserIds[0]',
      'body.addingUserIds[1]',
    ]);
  });

  test('runtime-scoped ids (kallIds, groupID) are exempt; the tenant kpostID beside them is not', () => {
    /*
     * `kallIds` and `groupID` name a call we placed and a group we made — runtime-scoped, created
     * during a flow, so they cannot be pre-allowlisted and are exempt like `msgID` (a fuzzer never
     * reaches them: no productionSafe endpoint accepts one). The kpostID list beside them is a TENANT
     * identifier and stays checked, so `modifyKallMembers`/`removeGroupMember` cannot target a
     * stranger even though their kallID/groupID rides along.
     */
    const foreign = foreignIdentifiers({
      body: { kallIds: [2, 3], groupID: 1141, memberKpostIdList: ['jitendra9@kpostindia.com'] },
    });
    expect(foreign.map((offence) => offence.path)).toEqual(['body.memberKpostIdList[0]']);
  });

  test('a bare `id` is exempt (an echoed row id), but a qualified id is still checked', () => {
    /*
     * `updateKallStatus`/`endKoolKall` echo the kall's row id as `{id: <our kall>}`. A bare `id` is
     * exempt (a runtime row id; this API names cross-tenant targets with a QUALIFIED key). The
     * exemption must be surgical: `companyID`/`kpostID` beside it stay refused, or it would be a hole.
     */
    const foreign = foreignIdentifiers({
      body: { id: 41307, companyID: 4, kpostID: 'x@y.kpost.in' },
    });
    expect(foreign.map((offence) => offence.path).sort()).toEqual([
      'body.companyID',
      'body.kpostID',
    ]);
  });

  test('reference data and bench-generated values are not treated as resources', () => {
    /*
     * If these were flagged, every request would be refused and somebody would switch the guard
     * off — which is how a safety control dies. `countryID: 1` is shared reference data, and
     * `sessionID`/`deviceID` are values this bench mints for itself.
     */
    const foreign = foreignIdentifiers({
      body: {
        countryID: 1,
        stateId: 12,
        sessionID: 'b0a1c2d3-e4f5-6789-abcd-ef0123456789',
        deviceID: '9f9d6bd8-238f-11ed-b3e2-73ce62ed0e94',
        deviceIdentity_primary: 'Desktop-Chrome',
        statusCode: 200,
        moduleId: 0,
      },
    });
    expect(foreign, 'reference and self-generated values must pass').toEqual([]);
  });

  test('the exact login payload the token provider sends passes the guard', () => {
    /*
     * Built by the real builder, not a hand-copied literal, so this breaks the moment a new field is
     * added to the login request that the guard would refuse. That is how `userType` was caught:
     * it contains "user", matched the identifier pattern, and would have refused every login on the
     * live application — failing the whole run before a single endpoint was tested.
     */
    const principal = AUTH_PROFILES.kpost.principals[0]!;
    const spec = AUTH_PROFILES.kpost.loginRequest(principal);
    const foreign = foreignIdentifiers({ body: spec.body });
    // Our own kpostID is QA-owned only when configured; everything else in the payload must pass.
    const unexpected = foreign.filter((offence) => !offence.path.endsWith('kpostID'));
    expect(unexpected, 'no field of the login payload is mistaken for a resource').toEqual([]);
  });

  test('path and query parameters are guarded too, not just the body', () => {
    const foreign = foreignIdentifiers({
      pathParams: { companyID: 999999 },
      query: { contactID: 'someone.else@kpostindia.com' },
    });
    expect(foreign.map((offence) => offence.path).sort()).toEqual([
      'path.companyID',
      'query.contactID',
    ]);
  });

  /*
   * ## Preflight: what the CURRENT environment is actually pointed at
   *
   * These assert the configuration rather than the code, so they only mean anything when the run
   * is aimed at the live application. Skipped otherwise - a developer running the framework suite
   * locally must not be told their `.env` is wrong for an environment they are not using.
   */
  test('live preflight: every module host is https and none is an internal address', () => {
    test.skip(!env.IS_PRODUCTION, 'only meaningful when TEST_ENV=production');

    const hosts = {
      KPOST_API_BASE_URL: env.KPOST_API_BASE_URL,
      ADMIN_API_BASE_URL: env.ADMIN_API_BASE_URL,
      KMAIL_API_BASE_URL: env.KMAIL_API_BASE_URL,
      BASE_URL: env.BASE_URL,
    };

    for (const [name, url] of Object.entries(hosts)) {
      // The one hard requirement: the host is SET. A blank host makes every endpoint 404, which reads
      // as an API defect — a configuration mistake dressed as a finding, exactly what this prevents.
      expect(url, `${name} must be set`).toBeTruthy();
      /*
       * The target is now a dedicated TEST environment (testingapi / testkmail / test.kpostindia.com,
       * and an on-prem admin box on the LAN), NOT the public production app. So an internal address or
       * plain http is legitimate here and is WARNED, not failed — the old hard rule assumed a public
       * live target and would false-fail a valid on-prem test host. The controls that actually prevent
       * harm (destructive-mutation disarm, the OTP/SMS kill-switch, the QA-identifier guard) are
       * asserted separately and stay armed regardless of the host.
       */
      if (/localhost|127\.0\.0\.1|192\.168\.|10\.\d+\.|172\.(1[6-9]|2\d|3[01])\./.test(url ?? '')) {
        console.warn(
          `[preflight] ${name} is an internal address (${url}) — expected for on-prem test.`,
        );
      }
      if (!/^https:\/\//.test(url ?? '')) {
        console.warn(`[preflight] ${name} is not https (${url}).`);
      }
    }
  });

  test('live preflight: destructive mutation stays disarmed and a live run is serial', () => {
    test.skip(!env.IS_PRODUCTION, 'only meaningful when TEST_ENV=production');

    /*
     * These never relax on live, and are the controls that actually protect the application:
     *  - the engine must never fuzz/mutate live data;
     *  - a live run is serial (concurrent logins answer 500 — a real finding, but it must not
     *    turn a whole filing run red).
     */
    expect(env.ALLOW_DESTRUCTIVE_TESTS, 'ALLOW_DESTRUCTIVE_TESTS must be false on live').toBe(
      false,
    );
    expect(env.WORKERS ?? 1, 'a live run must be serial: concurrent logins answer 500').toBe(1);

    /*
     * Bug filing on live is the owner's deliberate opt-in (`BUGZILLA_DRY_RUN`). The first-live-run
     * "keep it dry" precaution has been met — the environment is profiled — so filing is intentionally
     * armed. What keeps an armed run safe is not dry-run but the three filters that always apply:
     * the validity gate (drops infra noise / self-contradicting findings), the severity floor
     * (`BUGZILLA_MIN_SEVERITY`), and the live `[KPV2-…]` dedup (a re-run comments, never duplicates).
     * So dry-run is NOT forced here; only destructive mutation and parallelism stay hard-disarmed.
     */
  });

  /*
   * ## The OTP inventory stays in step with the definitions
   */
  test('every OTP-dependent endpoint in the report is flagged in its definition', () => {
    const reportPath = path.join(ROOT_DIR, 'contracts', 'otp-dependent-endpoints.md');
    /*
     * Generated by `npm run contract:otp`. Read from disk rather than recomputed, so this test
     * fails when the report is stale — which is the condition that would let a registered
     * endpoint lose its flag after a workbook dump.
     *
     * The report's own tables are the source: `| POST | `/path` | module | … |`. Parsed rather
     * than duplicated here, because a second hand-maintained list of 16 paths is a list that goes
     * out of date silently. The MENTIONS section is excluded — those endpoints neither send nor
     * consume an OTP, so they run on live like any other.
     */
    expect(fs.existsSync(reportPath), 'run npm run contract:otp').toBe(true);

    const report = fs.readFileSync(reportPath, 'utf8');
    const blockedSection = report.split('### MENTIONS')[0] ?? report;
    const blockedPaths = [...blockedSection.matchAll(/^\|\s*(\w+)\s*\|\s*`([^`]+)`\s*\|/gm)].map(
      (match) => `${match[1]} ${match[2]}`,
    );

    expect(blockedPaths.length, 'the OTP report should list the blocked endpoints').toBeGreaterThan(
      0,
    );

    const unflagged = apiRegistry
      .all()
      .filter((definition: EndpointDefinition) => {
        const key = `${definition.method} ${definition.contractPath ?? definition.path}`;
        return blockedPaths.includes(key) && !definition.otpDependent;
      })
      .map((definition: EndpointDefinition) => definition.id);

    expect(
      unflagged,
      'these are OTP-blocked on live but carry no otpDependent flag — they would fail 40 cases each',
    ).toEqual([]);
  });

  test('deep write-fuzz opens ONLY data writes, and never external/global/OTP', () => {
    const fuzz = {
      isProduction: true,
      allowDestructive: false,
      mockApi: false,
      writeFuzz: true,
      testDbMode: true,
    };
    const dataWrite: GuardedEndpoint = {
      label: 'createEvent',
      destructive: true,
      sideEffect: 'data',
    };
    const externalWrite: GuardedEndpoint = {
      label: 'addingUserByAdmin',
      destructive: true,
      sideEffect: 'external',
    };
    const globalWrite: GuardedEndpoint = {
      label: 'updateAppVersion',
      destructive: true,
      sideEffect: 'global',
    };
    const otpWrite: GuardedEndpoint = {
      label: 'sendOTP',
      destructive: true,
      sideEffect: 'data',
      otpDependent: 'sends',
    };

    // A `data` write is opened for the engine to fuzz on the disposable test DB.
    expect(destructiveBlockReason(dataWrite, fuzz), 'a data write is fuzzable').toBeUndefined();
    // Everything dangerous stays blocked, even with write-fuzz on.
    expect(destructiveBlockReason(externalWrite, fuzz), 'external stays blocked').toBeTruthy();
    expect(destructiveBlockReason(globalWrite, fuzz), 'global stays blocked').toBeTruthy();
    expect(destructiveBlockReason(otpWrite, fuzz), 'OTP/SMS stays blocked').toBeTruthy();

    // Without BOTH flags, write-fuzz does not open a data write on the live app.
    expect(
      destructiveBlockReason(dataWrite, { ...fuzz, testDbMode: false }),
      'writeFuzz needs testDbMode too',
    ).toBeTruthy();
    expect(
      destructiveBlockReason(dataWrite, { ...fuzz, writeFuzz: false }),
      'no writeFuzz → a data write stays blocked on live',
    ).toBeTruthy();
  });
});
