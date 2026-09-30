import { domainFor } from '@fixtures/test-accounts';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Does the Signup/Login UI actually surface a failing API response, or does it silently swallow it?
 * KPost's API wraps failures in an envelope anti-pattern — many calls answer HTTP 200 with a
 * `statusCode`/`status` field inside the body carrying the real outcome (confirmed in
 * `login-functional.spec.ts`'s stubbed-401-as-200 test) — so a UI that only checks the transport
 * status code, not the body, silently treats a failure as a success. This file targets the two
 * signup-critical calls not already covered by an existing filed bug (#821 forgot-password update,
 * #822 resend OTP, #823 OTP verify, #824 login network failure): the KPOST ID availability check and
 * the final registration submit — stubbed, so a failure here never risks a real account or company.
 *
 * Each test stubs the ONE call under test; every other call (OTP send/verify) goes through for real
 * via the confirmed-safe `OTP_TEST_GATEWAY` bypass, same gating as the rest of the Personal signup
 * suite.
 */
function freshMobile(): string {
  return `77${Date.now().toString().slice(-8)}`;
}

test.describe('KPost signup · API failure handling', { tag: '@ui' }, () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.skip(
    process.env.SIGNUP_UI_LIFECYCLE !== 'true',
    'drives the real signup screen (a mobile OTP is sent); set SIGNUP_UI_LIFECYCLE=true',
  );
  test.skip(
    process.env.OTP_TEST_GATEWAY !== 'true' || process.env.TEST_DB_MODE !== 'true',
    'the mobile OTP bypass code only validates on the confirmed OTP test gateway',
  );

  test('a failing KPOST ID availability check shows an error, not silence or a false "available" @ui', async ({
    signupPage,
    page,
  }) => {
    await signupPage.goto();
    await signupPage.chooseAccountType('Personal');
    await signupPage.selectCountryLanguageDomain('India', 'English', domainFor('PERSONAL'));

    const mobile = freshMobile();
    const otpOutcome = await signupPage.requestMobileOtp(mobile);
    test.skip(otpOutcome === 'already-exists', 'the random mobile happened to collide — re-run');
    const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
    test.skip(otpEntryOutcome === 'invalid', 'the OTP bypass code was rejected this run — re-run');

    await signupPage.fillPersonalDetails({
      firstName: 'QA',
      lastName: 'ApiFail',
      gender: 'Female',
      dobDay: 15,
      dobMonth: 'June',
      dobYear: 1995,
      pincode: testData.pinCode,
      area: 'Chennai',
    });
    await signupPage.continueToKpostId();

    // KPost's envelope anti-pattern: HTTP 200 carrying a failure — the exact shape a real gateway
    // timeout or server error takes on this backend (see login-functional.spec.ts's precedent).
    await page.route('**/kpostIdExist/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 500, status: 'FAILURE', message: 'Internal Server Error' }),
      });
    });

    await page.getByPlaceholder('Enter Preferred KPOST ID').fill(`qafail${mobile.slice(-6)}`);

    const available = page.getByText(/KpostID is Available/i);
    const taken = page.getByText(/This KpostID is already exists/i);
    const anyErrorToast = page.locator('.Toastify__toast, [class*="toast"]', { hasText: /error|fail|try again|something went wrong/i });

    const outcome = await Promise.race([
      available.waitFor({ state: 'visible', timeout: 10_000 }).then((): 'available' => 'available'),
      taken.waitFor({ state: 'visible', timeout: 10_000 }).then((): 'taken' => 'taken'),
      anyErrorToast.first().waitFor({ state: 'visible', timeout: 10_000 }).then((): 'error-shown' => 'error-shown'),
    ]).catch((): 'nothing' => 'nothing');

    test.info().annotations.push({ type: 'observed', description: `outcome when the check fails: ${outcome}` });

    // The two genuine failure modes: falsely reporting "available" (the user proceeds, then the real
    // signup fails later with no warning) and total silence (the user has no idea why nothing happens).
    expect(
      outcome,
      'a failed availability check must not be silently swallowed or misreported as "available"',
    ).not.toBe('available');
    expect(
      outcome,
      'a failed availability check must show SOME visible feedback, not nothing at all',
    ).not.toBe('nothing');
  });

  test('a failing final registration submit shows an error, not a false success @ui', async ({
    signupPage,
    page,
  }) => {
    await signupPage.goto();
    await signupPage.chooseAccountType('Personal');
    await signupPage.selectCountryLanguageDomain('India', 'English', domainFor('PERSONAL'));

    const mobile = freshMobile();
    const otpOutcome = await signupPage.requestMobileOtp(mobile);
    test.skip(otpOutcome === 'already-exists', 'the random mobile happened to collide — re-run');
    const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
    test.skip(otpEntryOutcome === 'invalid', 'the OTP bypass code was rejected this run — re-run');

    await signupPage.fillPersonalDetails({
      firstName: 'QA',
      lastName: 'SubmitFail',
      gender: 'Female',
      dobDay: 15,
      dobMonth: 'June',
      dobYear: 1995,
      pincode: testData.pinCode,
      area: 'Chennai',
    });
    await signupPage.continueToKpostId();
    const kpostIdOutcome = await signupPage.choosePreferredKpostId(`qasf${mobile.slice(-6)}`);
    test.skip(kpostIdOutcome === 'taken', 'the generated local part happened to collide — re-run');

    // Stub ONLY the final submit — every prior call (OTP, id check) already happened for real, so
    // this is the exact point a real backend failure would land, with no side effect either way.
    await page.route('**/signupLogin/signup/**', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 500, status: 'FAILURE', message: 'Internal Server Error' }),
      });
    });

    await page.getByPlaceholder('Enter Password').fill(testData.password);
    await page.getByPlaceholder(/Enter Confirm Password/).fill(testData.password);
    await page.locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: /^Submit$/i }).click();

    const success = page.getByText(/Successfully completed the Signup/i);
    const anyErrorToast = page.locator('.Toastify__toast, [class*="toast"]', { hasText: /error|fail|try again|something went wrong/i });

    const outcome = await Promise.race([
      success.waitFor({ state: 'visible', timeout: 10_000 }).then((): 'false-success' => 'false-success'),
      anyErrorToast.first().waitFor({ state: 'visible', timeout: 10_000 }).then((): 'error-shown' => 'error-shown'),
    ]).catch((): 'nothing' => 'nothing');

    test.info().annotations.push({ type: 'observed', description: `outcome when submit fails: ${outcome}` });

    expect(
      outcome,
      'a failed registration submit must never show the success modal to the user',
    ).not.toBe('false-success');
    expect(
      outcome,
      'a failed registration submit must show SOME visible feedback, not nothing at all',
    ).not.toBe('nothing');
  });
});
