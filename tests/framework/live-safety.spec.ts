import fs from 'node:fs';
import path from 'node:path';
import { apiRegistry } from '@api/definitions/index';
import type { EndpointDefinition } from '@api/registry/endpoint-definition';
import { AUTH_PROFILES } from '@config/auth-profile';
import { ROOT_DIR } from '@config/constants';
import { env } from '@config/env';
import {
  destructiveBlockReason,
  THROWAWAY_ACCOUNT_ID,
  type GuardedEndpoint,
} from '@engine/production-guard';
import {
  PRODUCTION_BLOCKED_VALIDATORS,
  PRODUCTION_SAFE_VALIDATORS,
  productionExclusion,
} from '@engine/production-validators';
import { foreignIdentifiers } from '@engine/qa-identifier-guard';
import { expect, test } from '@fixtures';
import { validationRegistry } from '@validators/index';

/**
 * The live-application safety controls: endpoint and validator allowlists, QA-identifier guard.
 * No HTTP and no environment needed, so they can never be skipped for want of a host.
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
    // A non-SMS destructive endpoint: the flag must not bypass the production allowlist.
    const unflagged: GuardedEndpoint = {
      label: 'POST /admin/removeCompanyLogo',
      destructive: true,
    };
    expect(
      destructiveBlockReason(unflagged, { isProduction: true, allowDestructive: true }),
      'the flag must not bypass the production allowlist',
    ).toContain('not cleared for the live application');

    // An external side effect stays blocked on live even when cleared: the SMS kill-switch wins.
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

  test('allowLiveRead unlocks a non-destructive "needs-id" read on live, and nothing else', () => {
    // Read-side counterpart to allowLiveWrite: lets a flow read back a record it just created.
    const needsIdRead: GuardedEndpoint = {
      label: 'GET /v2/group/downloadGroupProfileImage/{groupKpostID}/{kpostID}',
      destructive: false,
      sideEffect: 'data',
    };
    expect(
      destructiveBlockReason(needsIdRead, { isProduction: true, allowDestructive: false }),
      'blocked with no flag, exactly like today',
    ).toBeTruthy();
    expect(
      destructiveBlockReason(needsIdRead, {
        isProduction: true,
        allowDestructive: false,
        allowLiveRead: true,
      }),
      'unlocked once a caller explicitly authorizes this read',
    ).toBeUndefined();

    // It must NOT unlock a destructive endpoint — that stays allowLiveWrite's job exclusively.
    const destructiveWrite: GuardedEndpoint = {
      label: 'POST /v2/group/deleteGroup',
      destructive: true,
      sideEffect: 'data',
    };
    expect(
      destructiveBlockReason(destructiveWrite, {
        isProduction: true,
        allowDestructive: false,
        allowLiveRead: true,
      }),
      'allowLiveRead does not unlock a write',
    ).toBeTruthy();

    // It must NOT unlock an external/global read — same side-effect fence as allowLiveWrite.
    const globalRead: GuardedEndpoint = {
      label: 'GET /v2/admin/someoneElsesPassword',
      destructive: false,
      sideEffect: 'global',
    };
    expect(
      destructiveBlockReason(globalRead, {
        isProduction: true,
        allowDestructive: false,
        allowLiveRead: true,
      }),
      'allowLiveRead does not unlock a global-side-effect read',
    ).toBeTruthy();

    // The OTP/SMS kill-switch still supersedes — allowLiveRead cannot reach an OTP-dependent read.
    const otpRead: GuardedEndpoint = {
      label: 'GET /v2/common/checkOtpStatus',
      destructive: false,
      otpDependent: 'consumes',
    };
    expect(
      destructiveBlockReason(otpRead, {
        isProduction: true,
        allowDestructive: false,
        allowLiveRead: true,
      }),
      'allowLiveRead cannot unlock an OTP-dependent endpoint',
    ).toMatch(/OTP/);
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

  test('SMS/OTP kill-switch: an OTP/SMS sender is blocked in EVERY mode', () => {
    // Real SMS senders (incl. one caught only by the label backstop): refused in every mode.
    const senders: GuardedEndpoint[] = [
      { label: 'POST /v2/common/sendOTP/', destructive: true, otpDependent: 'sends' },
      { label: 'POST /v2/common/sendOTPtoMail/', destructive: true, sideEffect: 'external' },
      // mis-flagged on purpose (no otpDependent/external) — only the label backstop catches it:
      { label: 'POST /v2/common/forgotPasswordOTPOrSentKpostIDSms', destructive: true },
    ];
    for (const s of senders) {
      for (const flags of [
        { isProduction: true, allowDestructive: false },
        { isProduction: false, allowDestructive: true }, // NOT production, flag on
        { isProduction: false, allowDestructive: false, allowLiveWrite: true },
      ]) {
        expect(
          destructiveBlockReason(s, flags),
          `${s.label} must be blocked (flags ${JSON.stringify(flags)})`,
        ).toMatch(/kill-switch|OTP|SMS/i);
      }
    }
  });

  test('OTP test-gateway: OTP_TEST_GATEWAY + TEST_DB_MODE opens the OTP flows, and NOTHING else', () => {
    const otpSender: GuardedEndpoint = {
      label: 'POST /v2/common/sendOTP/',
      destructive: true,
      otpDependent: 'sends',
      sideEffect: 'external',
    };
    const registration: GuardedEndpoint = {
      label: 'POST /v2/signupLogin/adminRegistration/',
      destructive: true,
      otpDependent: 'requires',
      sideEffect: 'global',
    };
    const gateway = {
      isProduction: true,
      allowDestructive: false,
      otpTestGateway: true,
      testDbMode: true,
    };

    // BOTH flags → the OTP/signup flows are cleared on the disposable test gateway.
    expect(
      destructiveBlockReason(otpSender, gateway),
      'sendOTP runs on the test gateway',
    ).toBeUndefined();
    expect(
      destructiveBlockReason(registration, gateway),
      'registration runs on the test gateway',
    ).toBeUndefined();

    // The flag WITHOUT TEST_DB_MODE does NOT unlock — the disposable-DB contract is required (as WRITE_FUZZ).
    expect(
      destructiveBlockReason(otpSender, { ...gateway, testDbMode: false }),
      'no TEST_DB_MODE → OTP sender still blocked',
    ).toMatch(/kill-switch|OTP|SMS/i);

    // The gateway flag opens ONLY otpDependent/SMS endpoints — a non-OTP external/global write stays blocked.
    const nonOtpExternal: GuardedEndpoint = {
      label: 'POST /admin/addingUserByAdmin',
      destructive: true,
      sideEffect: 'external',
    };
    const nonOtpGlobal: GuardedEndpoint = {
      label: 'POST /v2/common/updateFlutterAppVersion',
      destructive: true,
      sideEffect: 'global',
    };
    expect(
      destructiveBlockReason(nonOtpExternal, gateway),
      'a non-OTP external write is NOT opened by the gateway flag',
    ).toBeTruthy();
    expect(
      destructiveBlockReason(nonOtpGlobal, gateway),
      'a non-OTP global write is NOT opened by the gateway flag',
    ).toBeTruthy();

    // Session-destroyers (deactivate, re-designate primary device) stay blocked on the gateway.
    for (const destroyer of [
      'POST /v2/profile/deactivateAccount/',
      'POST /v2/profile/setDeviceAsPrimary/',
      'POST /v2/profile/updateDeviceAsPrimary/',
    ]) {
      const ep: GuardedEndpoint = {
        label: destroyer,
        destructive: true,
        sideEffect: 'global',
        otpDependent: 'requires',
      };
      expect(
        destructiveBlockReason(ep, gateway),
        `${destroyer} must stay blocked even on the OTP test gateway`,
      ).toBeTruthy();
    }
  });

  test('every registered OTP/SMS sender is blocked against a real host', () => {
    const senders = apiRegistry
      .all()

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
        destructiveBlockReason(g, { isProduction: false, allowDestructive: true }),
        `${d.method} ${d.path} must be blocked even off-production`,
      ).toBeDefined();
    }
  });

  test('off production the guard keeps its previous behaviour', () => {
    const dataWrite: GuardedEndpoint = { label: 'POST /x', destructive: true };
    expect(
      destructiveBlockReason(dataWrite, { isProduction: false, allowDestructive: false }),
      'a test-owned data write needs no flag off production',
    ).toBeUndefined();

    // A `global` write off production is gated and the flag unlocks it (an SMS never unlocks).
    const globalWrite: GuardedEndpoint = {
      label: 'POST /x',
      destructive: true,
      sideEffect: 'global',
    };
    expect(
      destructiveBlockReason(globalWrite, { isProduction: false, allowDestructive: false }),
      'a global write is still gated off production',
    ).toContain('ALLOW_DESTRUCTIVE_TESTS=true');
    expect(
      destructiveBlockReason(globalWrite, { isProduction: false, allowDestructive: true }),
      'and the flag unlocks it off production',
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

    // Unclassified is denied at runtime (safe but silent); failing here forces the decision.
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
    // Validators whose method is "change the request and send it again".
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
    // Injection can turn a read into a write; cross-tenant/abuse probes hit other users.
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
    // A read persists nothing and the identifier guard confines it to our data: safe to fuzz.
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
      // Without endpoint context they stay blocked (safe default).
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
  test('a postal mailing address and an empty value are not identifiers; e-mails still are', () => {
    // The Admin employee body: `mailing*` is a place; an empty value names nothing.
    const body = {
      personalInformationObj: { alternativeMobileNo: '', alternativeEmailAddress: '' },
      mailingObj: { mailingCountry: 'India', mailingZipCode: '600001', mailingCity: 'Chennai' },
    };
    expect(foreignIdentifiers({ body }), 'postal fields and empty values pass').toEqual([]);
    expect(
      foreignIdentifiers({
        body: {
          ...body,
          personalInformationObj: {
            alternativeEmailAddress: 'someone@example.com',
            mobile: '9876543210',
          },
        },
      }).map((o) => o.path),
      'a real e-mail or mobile is still refused',
    ).toEqual([
      'body.personalInformationObj.alternativeEmailAddress',
      'body.personalInformationObj.mobile',
    ]);
  });

  test('a request naming a company we do not own is rejected', () => {
    // The exact payload the live application uses, with the owner's company id.
    const foreign = foreignIdentifiers({ body: { companyId: 4 } });
    expect(foreign.map((offence) => offence.path)).toEqual(['body.companyId']);
  });

  test('per-call minted identifiers: only the exact values, only for that call', () => {
    // `SendOptions.ownedIdentifiers`: a flow may allow the exact values its own write just minted
    // (values, never key names), for that one call only.
    const payload = {
      body: { kpostID: 'qarote171.ns@kpost.in', ksmaccCompanyID: 1083, employeeId: 'x' },
    };
    expect(
      foreignIdentifiers(payload).map((o) => o.path),
      'without the per-call list, both minted values are refused',
    ).toEqual(['body.kpostID', 'body.ksmaccCompanyID']);
    expect(
      foreignIdentifiers(payload, ['qarote171.ns@kpost.in', 1083]),
      'with them, the exact minted values pass',
    ).toEqual([]);
    expect(
      foreignIdentifiers({ body: { ...payload.body, kpostID: 'limson@kpostindia.com' } }, [
        'qarote171.ns@kpost.in',
        1083,
      ]).map((o) => o.path),
      'a different kpostID in the same key is still refused',
    ).toEqual(['body.kpostID']);
    expect(
      foreignIdentifiers({ body: { companyId: 4 } }).map((o) => o.path),
      'the list does not leak into the next call',
    ).toEqual(['body.companyId']);
  });

  test('bulk id arrays of tenant identifiers are checked element by element', () => {
    // The `removeGroupMember` / `modifyKallMembers` shape: a stranger cannot hide in one element.
    const foreign = foreignIdentifiers({
      body: { addingUserIds: ['jitendra9@kpostindia.com', 'limson@kpostindia.com'] },
    });
    expect(foreign.map((offence) => offence.path)).toEqual([
      'body.addingUserIds[0]',
      'body.addingUserIds[1]',
    ]);
  });

  test('runtime-scoped ids (kallIds, groupID) are exempt; the tenant kpostID beside them is not', () => {
    // kallIds/groupID are created during a flow (cannot be pre-allowlisted), so exempt like msgID.
    const foreign = foreignIdentifiers({
      body: { kallIds: [2, 3], groupID: 1141, memberKpostIdList: ['jitendra9@kpostindia.com'] },
    });
    expect(foreign.map((offence) => offence.path)).toEqual(['body.memberKpostIdList[0]']);
  });

  test('a bare `id` is exempt (an echoed row id), but a qualified id is still checked', () => {
    // `updateKallStatus`/`endKoolKall` echo the kall row id as `{id}`; tenants use qualified keys.
    const foreign = foreignIdentifiers({
      body: { id: 41307, companyID: 4, kpostID: 'x@y.kpost.in' },
    });
    expect(foreign.map((offence) => offence.path).sort()).toEqual([
      'body.companyID',
      'body.kpostID',
    ]);
  });

  test('reference data and bench-generated values are not treated as resources', () => {
    // Flagging these would refuse every request. countryID is shared; sessionID/deviceID are ours.
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
    // Built by the real builder, so a new login field the guard would refuse fails here.
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
   * ## Preflight: the current environment's configuration (skipped unless TEST_ENV=production)
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
      // A blank host makes every endpoint 404: a config mistake posing as a defect.
      expect(url, `${name} must be set`).toBeTruthy();
      // The target is an on-prem TEST environment, so internal/plain-http hosts only warn.
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

    expect(env.ALLOW_DESTRUCTIVE_TESTS, 'ALLOW_DESTRUCTIVE_TESTS must be false on live').toBe(
      false,
    );
    expect(env.WORKERS ?? 1, 'a live run must be serial: concurrent logins answer 500').toBe(1);
    // BUGZILLA_DRY_RUN is not forced: the validity gate, severity floor and dedup keep filing safe.
  });

  /*
   * ## The OTP inventory stays in step with the definitions
   */
  test('every OTP-dependent endpoint in the contracts is flagged in its definition', () => {
    /*
     * Derived from the contracts: an OTP endpoint `sends` (path names an OTP send), `consumes` (an
     * `otp` key in its payload) or `requires` (an earlier OTP step; not derivable, so listed here).
     */
    const REQUIRES_PRIOR_OTP = [
      'POST /v2/signupLogin/signup/', // verified: fails until sendOTP + validateMailOTP
      'POST /v2/signupLogin/adminRegistration/', // verified: the 5-step OTP sequence comes first
      'POST /v2/common/forgotPasswordUpdate', // verified: 400 "OTP validation failed"
      'POST /v2/profile/deactivateAccount/', // inferred: sendAccountDeactivationOtp has no consumer
      'POST /v2/profile/setDeviceAsPrimary/', // inferred: paired with sendPrimaryDeviceOtp
      'POST /v2/profile/updateDeviceAsPrimary/', // inferred: paired with sendPrimaryDeviceOtp
      'POST /v2/profile/setDeviceAsSecondary', // inferred: paired with sendPrimaryOrSecondaryDeviceOtp
      'POST /v2/profile/updateDeviceAsSecondary', // inferred: same sender
    ];
    const keysDeep = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.flatMap(keysDeep)
        : value && typeof value === 'object'
          ? Object.entries(value).flatMap(([key, nested]) => [key, ...keysDeep(nested)])
          : [];
    type ContractRow = {
      usable?: boolean;
      method?: string;
      path?: string;
      name?: string;
      requestExample?: unknown;
    };
    const rows = ['kpost-api', 'kmail-api'].flatMap((product): ContractRow[] => {
      const parsed = JSON.parse(
        fs.readFileSync(path.join(ROOT_DIR, 'contracts', `${product}.contract.json`), 'utf8'),
      ) as ContractRow[] | { endpoints?: ContractRow[] };
      return Array.isArray(parsed) ? parsed : (parsed.endpoints ?? []);
    });
    const blockedPaths = rows
      .filter((row) => row.usable !== false)
      .filter((row) => {
        const key = `${row.method} ${row.path}`;
        const sends = /send.*otp|otp.*sent|sentKpostIDSms|forgotPasswordOTP/i.test(
          `${row.path ?? ''} ${row.name ?? ''}`,
        );
        const consumes = keysDeep(row.requestExample).some((name) => /otp/i.test(name));
        return sends || consumes || REQUIRES_PRIOR_OTP.includes(key);
      })
      .map((row) => `${row.method} ${row.path}`);

    expect(blockedPaths.length, 'the contracts should contain OTP endpoints').toBeGreaterThan(0);
    for (const key of REQUIRES_PRIOR_OTP)
      expect(blockedPaths, `${key} is no longer in the contracts`).toContain(key);

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

  test('the forgot-password senders stay blocked even on the OTP test gateway (real SMS, one per run)', () => {
    const gateway = {
      isProduction: true,
      allowDestructive: true,
      otpTestGateway: true,
      testDbMode: true,
    };
    for (const label of [
      'POST /v2/common/forgotPasswordOTPOrSentKpostIDSms',
      'POST /v2/profile/forgotPasswordOrKpostID/',
    ]) {
      const sender: GuardedEndpoint = {
        label,
        destructive: true,
        sideEffect: 'external',
        otpDependent: 'sends',
      };
      expect(
        destructiveBlockReason(sender, gateway),
        `${label}: the test gateway does not make this SMS fake`,
      ).toMatch(/real phone even on the test gateway/);
      expect(
        destructiveBlockReason(sender, { ...gateway, noSmsRecipient: true }),
        `${label}: a request naming nobody real may run`,
      ).toBeUndefined();
    }
    // A normal OTP sender (signup) keeps the gateway unlock — its SMS is the 123456 bypass.
    const signupOtp: GuardedEndpoint = {
      label: 'POST /v2/signupLogin/sendOtp/',
      destructive: true,
      sideEffect: 'external',
      otpDependent: 'sends',
    };
    expect(destructiveBlockReason(signupOtp, gateway), 'signup OTP still opens').toBeUndefined();
  });

  test('the device and deactivation OTP senders stay blocked even on the OTP test gateway (they ignore the bypass)', () => {
    const gateway = {
      isProduction: true,
      allowDestructive: true,
      otpTestGateway: true,
      testDbMode: true,
      // Unlike forgot-password, these text the ACCOUNT's own phone: naming nobody is not possible.
      noSmsRecipient: true,
    };
    for (const label of [
      'GET /v2/profile/sendPrimaryDeviceOtp/',
      'GET /v2/profile/sendPrimaryOrSecondaryDeviceOtp/{requestType}',
      'GET /v2/profile/sendAccountDeactivationOtp/',
    ]) {
      const sender: GuardedEndpoint = {
        label,
        destructive: true,
        sideEffect: 'external',
        otpDependent: 'sends',
      };
      // The deactivation sender is already refused as a session-ender; the device senders by this rule.
      expect(
        destructiveBlockReason(sender, gateway),
        `${label}: the bypass does not cover it`,
      ).toMatch(
        /deactivation/i.test(label)
          ? /BLOCKED/
          : /texts the account's real phone even on the test gateway/,
      );
    }
    // common/sendOTP honours the bypass, so flows mint the same OTP types through it.
    const commonOtp: GuardedEndpoint = {
      label: 'POST /v2/common/sendOTP/',
      destructive: true,
      sideEffect: 'external',
      otpDependent: 'sends',
    };
    expect(
      destructiveBlockReason(commonOtp, gateway),
      'common/sendOTP still opens',
    ).toBeUndefined();
  });

  test('a throwaway account opens session-ending actions on the gateway, never a real-SMS sender', () => {
    const gateway = {
      isProduction: true,
      allowDestructive: true,
      otpTestGateway: true,
      testDbMode: true,
    };
    const deactivate: GuardedEndpoint = {
      label: 'POST /v2/profile/deactivateAccount/',
      destructive: true,
      sideEffect: 'global',
      otpDependent: 'requires',
    };
    const changePassword: GuardedEndpoint = {
      label: 'POST /v2/profile/changePassword',
      destructive: true,
      sideEffect: 'global',
    };
    expect(
      destructiveBlockReason(deactivate, gateway),
      'qatest1 can never be deactivated',
    ).toBeDefined();
    expect(
      destructiveBlockReason(changePassword, gateway),
      'nor its password changed',
    ).toBeDefined();
    for (const action of [deactivate, changePassword])
      expect(
        destructiveBlockReason(action, { ...gateway, throwawayAccount: true }),
        `${action.label} runs on the throwaway account`,
      ).toBeUndefined();
    // Without the OTP test gateway on the test DB the flag opens nothing.
    expect(
      destructiveBlockReason(deactivate, {
        ...gateway,
        otpTestGateway: false,
        throwawayAccount: true,
      }),
    ).toBeDefined();
    // The real-SMS senders stay blocked even for a throwaway account.
    expect(
      destructiveBlockReason(
        {
          label: 'GET /v2/profile/sendPrimaryDeviceOtp/',
          destructive: true,
          sideEffect: 'external',
          otpDependent: 'sends',
        },
        { ...gateway, throwawayAccount: true },
      ),
    ).toMatch(/real phone/);
    expect(THROWAWAY_ACCOUNT_ID.test('apiflowkpost3@kpostindia.com')).toBe(true);
    expect(THROWAWAY_ACCOUNT_ID.test('qatest1@kpostindia.com')).toBe(false);
  });
});
