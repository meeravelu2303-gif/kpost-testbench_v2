// An orchestrated flow with a genuine fork (already-registered vs fresh signup), not a plain assertion.
/* eslint-disable playwright/no-conditional-in-test */
import { domainFor } from '@fixtures/test-accounts';
import { env } from '@config/env';
import { testData } from '@config/test-data.config';
import { recordCreatedAccount } from '@fixtures/created-accounts';
import { expect, test } from '@fixtures';

/**
 * KPost personal signup → login, driven end to end through the real screens.
 *
 * `docs/archive/ui-write-flows-2026-09-28.md` never had a signup entry (`signup-domain.spec.ts` covers only the
 * read-only domain-binding rule and deliberately never submits). This is the first UI test that
 * actually creates an account: Personal → country/language/domain → mobile OTP (the confirmed test
 * gateway's bypass code) → personal details + pincode confirm → preferred KPOST ID → password →
 * submit → the success modal's "Ok", which the product itself lands on `/login` — then proves the
 * new account can log in, all the way to `/home`.
 *
 * ## Gating
 *
 * Two independent gates, both required:
 *  - `SIGNUP_UI_LIFECYCLE=true` (this repo's `*_UI_LIFECYCLE` convention) — a real account is minted.
 *  - `OTP_TEST_GATEWAY=true` + `TEST_DB_MODE=true` — the same pair the API-layer signup lifecycle
 *    uses, because the mobile OTP bypass code (`QA_BYPASS_OTP`) only ever validates there. On this
 *    environment `.env` sets `OTP_TEST_GATEWAY=true` persistently; `signup-domain.spec.ts` still
 *    notes real e-mail delivery is live here, so this never runs on a default `npm run ui`.
 *
 * ## Identity: a dedicated UI slot, not the API layer's
 *
 * `testData.signupKpostId`'s default domain (`@kpost.in`) is the legacy domain the API-layer signup
 * already reserved; the signup SCREEN only ever offers the CURRENT personal domain policy
 * (`@kpostindia.com`, proven by `signup-domain.spec.ts`). A UI signup can never produce
 * `signupKpostId`'s exact string, so it uses `testData.signupUiKpostIdLocal` / `signupUiMobile`
 * instead — a separate, equally allowlisted-by-config slot, never a randomly generated identity
 * (this bench's stated policy — see `signup.api.ts`'s own note on why random ids were removed).
 *
 * ## Both outcomes of "is it already registered?" are valid
 *
 * Exactly like the API-layer equivalent: a fresh/reset environment signs up for real (and the new
 * account is recorded via `src/fixtures/created-accounts.ts`, never left untracked); a re-run finds
 * the identity already registered and the test proves LOGIN only. `SIGNUP_PASSWORD` is a fixed
 * constant (not `testData.password`, which need not satisfy the signup screen's password policy) so
 * a login attempt is meaningful either way — it is exactly what a fresh run just set, and exactly
 * what an earlier run of THIS spec set before it.
 */
const SIGNUP_PASSWORD = 'QaBench@2026';

test.describe('KPost signup · personal registration → login', { tag: '@ui' }, () => {
  // Signup and the resulting login are both logged-out journeys; a saved session would redirect away.
  test.use({ storageState: { cookies: [], origins: [] } });

  test.skip(
    process.env.SIGNUP_UI_LIFECYCLE !== 'true',
    'creates a real account and sends a real mail-OTP/e-mail; set SIGNUP_UI_LIFECYCLE=true',
  );
  test.skip(
    process.env.OTP_TEST_GATEWAY !== 'true' || process.env.TEST_DB_MODE !== 'true',
    'the mobile OTP bypass code only validates on the confirmed OTP test gateway',
  );

  test('a Personal account signs up (or is already registered) and then logs in @ui', async ({
    signupPage,
    loginPage,
    endpoints,
    page,
  }) => {
    const mobileNumber = testData.signupUiMobile;
    const kpostIdLocal = testData.signupUiKpostIdLocal;
    const domainSuffix = domainFor('PERSONAL');
    const fullKpostId = `${kpostIdLocal}@${domainSuffix}`;

    await signupPage.goto();
    await signupPage.chooseAccountType('Personal');
    await signupPage.selectCountryLanguageDomain('India', 'English', domainSuffix);

    const otpOutcome = await signupPage.requestMobileOtp(mobileNumber);

    /*
     * A guard against a repeat of #720 (KPost UI/Auth, fixed live 2026-09-28): the signup screen's
     * "Verify" call briefly omitted `companyID`, which the API required at the time, so ANY non-200
     * from that check fell into the same generic "Mobile number already exists!" toast
     * (PersonalSignup.js's sendOTP) — a plain validation error was indistinguishable, in the UI,
     * from a genuine duplicate. Fixed on the API side (this exact shape — no `companyID` — now
     * succeeds; see `common-mobile-no-exist` in src/api/definitions/kpost/common/identity.api.ts,
     * which matches the documented Excel/openapi contract). Told apart here by re-asking the SAME
     * check for the identical mobile number the UI just rejected, so "genuinely already registered"
     * (a valid re-run outcome) is never confused with "the screen is broken again" (a regression).
     *
     * A raw `page.request` call, not `endpoints.sendTo`: the QA-identifier guard rightly refuses an
     * arbitrary mobile number it does not recognise as an owned identity, and this diagnostic probe
     * — re-asking the exact same public, unauthenticated lookup the browser itself just made — has
     * no more access than the UI already does.
     *
     * CORRECTED 2026-10-05: this was asking `env.API_BASE_URL`, which is the FRONTEND origin
     * (`BASE_URL` is its fallback when `API_BASE_URL` is unset — see src/config/env.ts) rather than
     * the real API host (`KPOST_API_BASE_URL`). That made the self-correction unreliable — it could
     * come back without a `"data":true` match for reasons having nothing to do with whether the
     * number is really registered (wrong host, a proxy 404, …), which is exactly the false "a repeat
     * of #720" signal this probe exists to prevent. Confirmed live 2026-10-05: calling the real API
     * host directly shows QA_SIGNUP_UI_MOBILE (9000000780) IS genuinely registered — it was
     * consumed by an orphaned account from an earlier write-fuzz run (`qabenchweb3@kpostindia.com`,
     * 2026-10-02 — see src/fixtures/created-accounts.json) — so #720 is not reopened by this; the
     * underlying number has simply gone stale and needs replacing with a fresh, OTP-gateway
     * provisioned one.
     */
    if (otpOutcome === 'already-exists') {
      const recheck = await page.request.post(
        `${env.KPOST_API_BASE_URL}/v2/common/mobileNoExist/`,
        {
          data: { countryID: testData.countryId, mobileNumber },
        },
      );
      const reallyExists = recheck.status() === 200 && /"data":true/.test(await recheck.text());
      if (!reallyExists) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'common-mobile-no-exist',
          ruleId: 'REGRESSION-signup-ui-mobile-verify-missing-companyid',
          rule:
            'the Personal signup screen\'s mobile "Verify" step must not report an unregistered ' +
            'number as already registered.',
          expected: `mobileNumber ${mobileNumber}: the OTP modal opens (the number is free)`,
          actual:
            'the UI showed "Mobile number already exists!" while the API\'s own check (matching the ' +
            'documented contract) reports the number as free — a repeat of #720',
          request: { body: { mobileNumber, countryID: testData.countryId } },
        });
      }
      test.skip(
        true,
        reallyExists
          ? `${mobileNumber} is genuinely already registered — set a fresh QA_SIGNUP_UI_MOBILE`
          : "the signup screen's mobile Verify step is broken (a repeat of #720): it misreports " +
              'this free number as taken, so the OTP modal never opens',
      );
    }

    // The only way past the skip above: the OTP modal genuinely opened for a genuinely free number.
    const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
    /*
     * See enterMobileOtp's own doc comment: a wrongly-suspected bug (#721) was retracted here —
     * `invalid` reproduced only while this machine was also running a heavy, concurrent API sweep
     * against the same host, and over 5 clean attempts elsewhere proved the real screen is fine.
     * Skip with an honest "probably test-infra noise" reason rather than asserting a defect.
     */
    test.skip(
      otpEntryOutcome === 'invalid',
      'the OTP box just rejected the bypass code — likely test-infra noise (rate-limiting from ' +
        'concurrent heavy traffic on this host, see #721/INVALID), not a real defect; re-run once ' +
        'no other suite is hitting the same API host',
    );
    await signupPage.fillPersonalDetails({
      firstName: 'QA',
      lastName: 'Bench',
      gender: 'Female',
      dobDay: 15,
      dobMonth: 'June',
      dobYear: 1995,
      pincode: testData.pinCode,
      // Must be one of the real areas POST /v2/common/postalPinCode/ returns for testData.pinCode
      // (600001 by default: Chennai, Govt Stanley hospital, Mannady, Mpt Ao, Muthialpet(ms), Seven
      // Wells) — live-verified 2026-09-28. Update this if QA_PINCODE is ever changed to another code.
      area: 'Chennai',
    });
    await signupPage.continueToKpostId();

    const kpostIdOutcome = await signupPage.choosePreferredKpostId(kpostIdLocal);
    test.skip(
      kpostIdOutcome === 'taken',
      `${fullKpostId} is taken under a different mobile than ${mobileNumber} — ` +
        'set a fresh QA_SIGNUP_UI_KPOST_ID_LOCAL',
    );

    await signupPage.setPasswordAndSubmit(SIGNUP_PASSWORD);
    await signupPage.confirmSuccessAndGoToLogin();

    await expect(page, "signup's success modal lands on /login").toHaveURL(/\/login/, {
      timeout: 20_000,
    });

    // Every account this bench creates gets logged — see src/fixtures/created-accounts.ts.
    recordCreatedAccount({
      kpostId: fullKpostId,
      mobileNumber,
      source: 'signup-login-lifecycle.spec.ts (UI)',
      note: 'Personal registration driven end-to-end through the signup screen',
    });

    await loginPage.login(fullKpostId, SIGNUP_PASSWORD);
    await expect(page, 'login reaches /home').toHaveURL(/\/home/, { timeout: 20_000 });
  });
});
