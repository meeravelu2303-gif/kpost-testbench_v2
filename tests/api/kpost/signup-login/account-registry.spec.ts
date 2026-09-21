import { env } from '@config/env';
// An orchestrated signup chain with conditional stages, not simple assertions.
/* eslint-disable playwright/no-conditional-in-test */
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import {
  accountRegistry,
  currentEnvironment,
  type CleanupCoordinator,
} from '../../../../src/test-data/index';
import { assessSignup, availabilityFromExistCheck } from '../../../../src/signup/index';

/**
 * Phase 4D Part B — live account-registry integration.
 *
 * ## The two stages, and why they are gated differently
 *
 * **Stage 1 — availability (read-only).** `kpostIdExist` is `productionSafe` and already runs on a
 * normal live pass. It creates nothing, so it is gated only by the owner's existing
 * `OTP_TEST_GATEWAY` setting, and it answers the question the registry most needs: does the reserved
 * signup identity already exist on this deployment?
 *
 * **Stage 2 — the signup itself.** `signup-login-signup` is `destructive` + `sideEffect: 'global'`
 * because **an account cannot be deleted through this API**: every successful run leaves a permanent
 * row. It therefore additionally requires `TEST_DB_MODE`, which is the owner's declaration that the
 * database is disposable. That declaration is not the bench's to make, so this spec asks for it
 * rather than assuming it.
 *
 * ## What is NOT asserted
 *
 * Nothing about whether the application's answers are correct. The registry records an account only
 * when creation is CONFIRMED by application evidence — availability before and after — never by an
 * HTTP status. A rejected, ambiguous or pre-existing outcome registers nothing, and says so.
 */

const OTP = testData.bypassOtp;
const SIGNUP_FLOW_ID = 'otp-signup-personal';

/** Asks the application whether an id is taken. Read-only, and the evidence the registry relies on. */
async function availability(
  endpoints: EndpointExecutor,
  kpostId: string,
  label: string,
): Promise<{ status: number; availability: ReturnType<typeof availabilityFromExistCheck> }> {
  const exchange = await endpoints.sendTo(
    'signup-login-kpost-id-exist',
    {
      body: {
        kpostID: kpostId,
        firstName: 'QA',
        lastName: 'Bench',
        mobileNumber: testData.signupMobile,
      },
    },
    { label },
  );
  return { status: exchange.status, availability: availabilityFromExistCheck(exchange.status) };
}

test.describe('KPost signup · account registry integration', { tag: '@kpost-api' }, () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(
    !env.OTP_TEST_GATEWAY,
    'signup identity checks run only against a confirmed OTP test gateway (OTP_TEST_GATEWAY=true)',
  );

  test('the reserved signup identity’s availability is established @api @signup @registry', async ({
    endpoints,
  }: {
    endpoints: EndpointExecutor;
  }, testInfo) => {
    const kpostId = testData.signupKpostId;
    const before = await availability(endpoints, kpostId, 'registry:availability');

    /*
     * Infrastructure precondition only: the check must have ANSWERED. Whether the id is available or
     * taken is data, not a verdict — both are legitimate states of the deployment.
     */
    expect(before.status, 'the availability check answered').toBeGreaterThan(0);

    await testInfo.attach('signup-availability.json', {
      body: JSON.stringify(
        {
          environment: currentEnvironment(),
          kpostId,
          httpStatus: before.status,
          availability: before.availability,
          note:
            before.availability === 'TAKEN'
              ? 'The reserved identity already exists on this deployment, so a signup here would ' +
                'answer "already exists" and create nothing. Per the registry rules that registers ' +
                'NOTHING: the account is not this run’s to claim.'
              : 'The reserved identity is free, so a gated signup would create it.',
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });

  test('a confirmed signup registers exactly one account @api @signup @registry', async ({
    endpoints,
    resources,
  }: {
    endpoints: EndpointExecutor;
    resources: CleanupCoordinator;
  }, testInfo) => {
    test.skip(
      !env.TEST_DB_MODE,
      'creates a PERMANENT account (KPOST cannot delete a signup account): set TEST_DB_MODE=true ' +
        'to declare the database disposable — the owner’s call, not the bench’s',
    );

    const kpostId = testData.signupKpostId;
    const environment = currentEnvironment();
    const registry = accountRegistry();

    const before = await availability(endpoints, kpostId, 'registry:availability:before');

    // Drive the documented OTP chain the signup requires. Both OTPs must be validated first.
    for (const [id, body, label] of [
      [
        'common-send-otp',
        {
          countryID: testData.countryId,
          mobileNumber: testData.signupMobile,
          requestType: 'signup',
        },
        'registry:otp:send-mobile',
      ],
      [
        'common-validate-otp',
        { otp: OTP, countryID: testData.countryId, mobileNumber: testData.signupMobile },
        'registry:otp:validate-mobile',
      ],
      ['common-send-otp-to-mail', { otherEmail: testData.otpEmail }, 'registry:otp:send-mail'],
      [
        'common-validate-mail-otp',
        { email: testData.otpEmail, otp: Number(OTP) },
        'registry:otp:validate-mail',
      ],
    ] as const) {
      await endpoints.sendTo(id, { body }, { label, allowLiveWrite: true });
    }

    const signup = await endpoints.sendTo(
      'signup-login-signup',
      {},
      { label: 'registry:signup', allowLiveWrite: true },
    );
    const parsed = signup.json();
    const envelope = (parsed.ok ? parsed.value : {}) as Record<string, unknown>;

    const after = await availability(endpoints, kpostId, 'registry:availability:after');

    // The decision: application evidence, never the status code.
    const assessment = assessSignup({
      signupStatus: signup.status,
      ...(typeof envelope.status === 'string' ? { envelopeStatus: envelope.status } : {}),
      availabilityBefore: before.availability,
      availabilityAfter: after.availability,
    });

    if (assessment.shouldRegister) {
      const record = registry.register({
        kpostId,
        environment,
        source: 'signup',
        verified: true,
        verificationNote: assessment.reason,
        signupFlowId: SIGNUP_FLOW_ID,
        userType: 'PERSONAL',
        role: 'USER',
      });
      registry.updateStatus(record.accountId, 'ACTIVE');

      /*
       * Also tracked in the resource ledger — the two answer different questions, and both are
       * wanted. The ledger's cleanup is a no-op here BY DESIGN: KPOST exposes no way to delete a
       * signup account, so the operation records that fact instead of pretending to delete.
       */
      resources.track({
        kind: 'kpost-account',
        id: record.accountId,
        describe: 'signup account (not deletable through this API)',
        cleanup: () => {
          registry.retire(record.accountId, 'KPOST exposes no signup-account deletion');
          return Promise.resolve('retired-not-deleted');
        },
      });
    }

    /*
     * Asserted unconditionally, which is the stricter statement: the registry holds the account
     * EXACTLY when the assessment confirmed creation. A conditional assertion would have proved
     * only the positive half and stayed silent on the case that matters more — that a rejected or
     * ambiguous signup left nothing behind.
     */
    const held = registry.findByKpostId(environment, kpostId) !== undefined;
    expect(held, 'the registry holds the account only when creation was confirmed').toBe(
      assessment.shouldRegister,
    );

    await testInfo.attach('signup-registration.json', {
      body: JSON.stringify(
        {
          environment,
          kpostId,
          signupHttpStatus: signup.status,
          availabilityBefore: before.availability,
          availabilityAfter: after.availability,
          outcome: assessment.outcome,
          registered: assessment.shouldRegister,
          reason: assessment.reason,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });

    // Infrastructure precondition: the chain ran and produced a decision. NOT a claim that the
    // outcome should have been any particular value.
    expect(
      ['CONFIRMED', 'ALREADY_EXISTS', 'REJECTED', 'AMBIGUOUS'],
      'the signup produced an assessable outcome',
    ).toContain(assessment.outcome);
  });
});
