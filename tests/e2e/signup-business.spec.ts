import { SignupPage } from '@pages/SignupPage';
import { testData } from '@config/test-data.config';
import { recordCreatedAccount } from '@fixtures/created-accounts';
import { expect, test } from '@fixtures';

/**
 * **Business (Small) signup** — the second of the two account types the signup screen offers.
 * Reached via `chooseAccountType('Business')`, which shows a CATEGORY picker (Small / Medium /
 * Large / Multi-National) before any registration form mounts. Only "Small" is wired to a real,
 * self-serve flow today (`SmallBusiness.js`); Medium/Large use a separate, much larger component not
 * covered here, and Multi-National is unimplemented (just a toast).
 *
 * Country/Language/Domain, the mobile-OTP mechanism, the date-of-birth 18-year floor, the password
 * policy, and the success modal are IDENTICAL to Personal's (same components) — this file only adds
 * the Business-only screens (Company Details) and the category picker, and reuses everything else
 * from `SignupPage`.
 *
 * Safety: the read-only/validation tests never reach Submit. The one full-lifecycle write test is
 * gated behind `SIGNUP_UI_LIFECYCLE=true` (same flag as Personal's) and mints a real, PERMANENT
 * company (`adminRegistration` is a `global` side effect on the API side — a company cannot be
 * deleted through this API), so it uses its own reserved identity
 * (`QA_SIGNUP_BUSINESS_UI_MOBILE`/`QA_SIGNUP_BUSINESS_COMPANY_NAME`/etc.) and is expected to run at
 * most once per identity, same convention as Personal's lifecycle spec.
 *
 * ## Mobile-number uniqueness — the real rule, confirmed with the product owner (2026-09-29)
 *
 * One mobile number MAY legitimately belong to multiple Business accounts, as long as each is a
 * DIFFERENT company — confirmed live: registering a fresh company with an already-registered mobile
 * (no pre-check on this path, unlike Personal's) succeeds outright (200), and this is correct,
 * intended behavior, not a defect. What must never happen is the SAME company having two
 * members/accounts sharing one mobile number — this IS covered, but not from this file: the
 * `admin-adding-user-by-admin` / `POST /admin/addingUserByAdmin/` API endpoint is a `global`-
 * side-effect write this bench's own production-safety guard blocks unconditionally (by design —
 * `productionSafe` is checked before `ALLOW_DESTRUCTIVE_TESTS`, which can never unlock a `global`
 * write here), so that path is not how this gets tested. Instead, see
 * `tests/e2e/usermanagement.spec.ts` ("adding a member with a mobile already used in THIS company is
 * rejected"): the REAL admin UI, through a normal authenticated session (`STORAGE_STATE_BUSINESS`,
 * no bypass of any kind), confirms the rejection — `POST /v2/common/mobileNoExistInsideCompany/`
 * correctly reports the collision and the form stays blocked before ever reaching ADD, so that test
 * is fully safe to run unattended and never provisions a real member.
 */
test.describe('KPost signup · Business category picker (read-only)', { tag: '@ui' }, () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('all four categories are offered, and Multi-National is honestly unimplemented @ui', async ({
    page,
  }) => {
    const signup = new SignupPage(page);
    await signup.goto();
    await signup.chooseAccountType('Business');

    // Each card renders twice (a hidden responsive/mobile duplicate alongside the visible one) —
    // confirmed live: 8 `.category-contentBox-layout` elements, 4 visible + 4 `display:none`.
    for (const category of ['Small', 'Medium', 'Large', 'Multi-National']) {
      await expect(
        page.locator('.category-contentBox-layout', { hasText: category }).filter({ visible: true }),
        `the ${category} category card is offered`,
      ).toBeVisible({ timeout: 15_000 });
    }

    // Multi-National has no registration flow behind it — it must say so, not silently do nothing
    // and not pretend to proceed. A toast is the product's own documented way of saying "not yet".
    await signup.chooseBusinessCategory('Multi-National');
    await expect(
      page.getByText(/currently in progress/i),
      'Multi-National honestly reports it is not implemented, rather than proceeding or going silent',
    ).toBeVisible({ timeout: 10_000 });
  });

  test('choosing Small reaches the Business registration form @ui', async ({ page }) => {
    const signup = new SignupPage(page);
    await signup.goto();
    await signup.chooseAccountType('Business');
    await signup.chooseBusinessCategory('Small');

    // Same first screen as Personal: Country/Language/Domain selects + Continue.
    await expect(
      page.locator('input[id^="react-select"]').first(),
      'the Business registration form opens with its Country/Language/Domain selects',
    ).toBeVisible({ timeout: 15_000 });
  });
});

/**
 * See #825 (CRITICAL, confirmed 2026-09-29): below the 992px desktop/mobile CSS breakpoint, the app
 * routes into a separate, self-contained legacy signup implementation embedded in MainSignup.js
 * (not the SmallBusiness.js component desktop uses). Personal signup works correctly on this path;
 * Business does not — tapping any category resets the whole flow back to the account-type picker.
 * Read-only: never reaches a form, so there's nothing to clean up either way.
 */
test.describe('KPost signup · mobile viewport (below 992px)', { tag: '@ui' }, () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 480, height: 900 } });

  test('Personal reaches its registration form on a mobile viewport @ui', async ({ page }) => {
    const signup = new SignupPage(page);
    await signup.goto();
    await page.getByText(/^Personal$/i).filter({ visible: true }).first().click();

    await expect(
      page.locator('input[id^="react-select"]').first(),
      'Personal signup reaches its Country/Language/Domain form on mobile',
    ).toBeVisible({ timeout: 15_000 });
  });

  test('Business (Small) does NOT reach a registration form on a mobile viewport — #825 @ui', async ({
    page,
  }) => {
    const signup = new SignupPage(page);
    await signup.goto();
    await page.getByText(/^Business$/i).filter({ visible: true }).first().click();
    await page.waitForTimeout(500);
    await page.getByText(/^Small$/i).filter({ visible: true }).first().click();
    await page.waitForTimeout(1500);

    // This SHOULD find a registration form (documenting #825 until it's fixed) — today it instead
    // finds itself back on the very first "Select Account Option" screen.
    await expect(
      page.locator('input[id^="react-select"]').first(),
      'Business signup should reach a registration form on mobile, matching Personal — see #825',
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('KPost Business signup · field validation', { tag: '@ui' }, () => {
  test.skip(
    process.env.OTP_TEST_GATEWAY !== 'true' || process.env.TEST_DB_MODE !== 'true',
    'needs the OTP test gateway; set OTP_TEST_GATEWAY=true TEST_DB_MODE=true',
  );
  test.use({ storageState: { cookies: [], origins: [] } });

  function freshMobile(): string {
    return `78${Date.now().toString().slice(-8)}`;
  }

  /** Drives every screen up to (not including) Company Details, for the validation tests below. */
  async function reachCompanyDetails(signup: SignupPage, page: import('@playwright/test').Page) {
    await signup.goto();
    await signup.chooseAccountType('Business');
    await signup.chooseBusinessCategory('Small');
    await signup.selectCountryLanguageDomain('India', 'English', 'kpost.in');

    const otpOutcome = await signup.requestMobileOtp(freshMobile());
    test.skip(otpOutcome === 'already-exists', 'the random mobile happened to collide — re-run');
    const otpEntryOutcome = await signup.enterMobileOtp(testData.bypassOtp);
    test.skip(otpEntryOutcome === 'invalid', 'the OTP bypass code was rejected this run — re-run');

    await signup.fillBusinessPersonalDetails({
      firstName: 'QA',
      lastName: 'Validate',
      gender: 'Male',
      dobDay: 15,
      dobMonth: 'June',
      dobYear: 1995,
    });
    await page.getByRole('button', { name: /^Continue$/i }).click({ force: true });
    await expect(
      page.getByPlaceholder('Enter Company Name'),
      'the Company Details screen is reached',
    ).toBeVisible({ timeout: 15_000 });
  }

  test('an already-registered company name is rejected with a proper message @ui', async ({
    page,
    signupPage,
  }) => {
    await reachCompanyDetails(signupPage, page);

    const companyNameField = page.getByPlaceholder('Enter Company Name');
    await companyNameField.fill(testData.companyName);
    await companyNameField.blur();

    await expect(
      page.getByText(/Company name already exists/i),
      'a real, already-registered company name is rejected with a specific message, not silently accepted',
    ).toBeVisible({ timeout: 10_000 });
  });

  test('a genuinely-available Business Short Unique Name is accepted @ui', async ({
    page,
    signupPage,
  }) => {
    await reachCompanyDetails(signupPage, page);

    // No known-taken unique name exists in test data (testData.uniqueName is confirmed genuinely
    // available via a live check — see the investigation that led to #816), so the positive case is
    // what this can honestly assert live; the negative case (already-taken) is covered below by
    // stubbing the endpoint directly, since #816 already proves this component's error-display path
    // for the sibling Company Name field is broken and the same pattern is worth checking here too.
    const { uniqueNameOutcome } = await signupPage.fillCompanyDetails({
      companyName: `QA Fresh Co ${Date.now()}`,
      typeOfBusiness: 'QA Testing',
      pincode: testData.pinCode,
      area: 'Chennai',
      adminDesignation: 'Manager',
      preAdminDesignationId: `q${Date.now().toString().slice(-6)}`,
      businessUniqueName: testData.uniqueName,
    });

    expect(uniqueNameOutcome, 'a genuinely-available unique name is accepted').toBe('available');
  });

  test('an already-taken Business Short Unique Name (stubbed) shows a proper message @ui', async ({
    page,
    signupPage,
  }) => {
    // No real already-taken unique name is available in test data, so the server's rejection is
    // stubbed here — the subject under test is the CLIENT's rendering of that response, which a
    // stubbed 409 exercises exactly as well as a real one (same convention as
    // login-functional.spec.ts's stubbed-error test).
    await page.route('**/uniqueNameExist**', async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'uniqueName is already exists!',
          urlPath: '/uniqueNameExist/',
          status: 'FAILURE',
          statusCode: 409,
        }),
      });
    });

    await reachCompanyDetails(signupPage, page);
    await signupPage.fillCompanyDetails({
      companyName: `QA Fresh Co ${Date.now()}`,
      typeOfBusiness: 'QA Testing',
      pincode: testData.pinCode,
      area: 'Chennai',
      adminDesignation: 'Manager',
      preAdminDesignationId: `q${Date.now().toString().slice(-6)}`,
      businessUniqueName: 'anything',
    }).catch(() => undefined); // fillCompanyDetails' own outcome race isn't the point here

    await expect(
      page.getByText(/Business Short Unique Name already exists/i),
      'a server-side rejection of the unique name is shown to the user, not silently swallowed',
    ).toBeVisible({ timeout: 10_000 });
  });

  /*
   * Confirmed from source (SmallBusiness.js): Submit's `disabled` expression ANDs five conditions
   * together, including `password !== confirmpassword` — so in the normal case (matching passwords)
   * the button is NOT disabled even with the agree-checkbox unchecked. The actual gate is inside the
   * onClick handler (`if (agreeChecked) { adminRegister(); }`), so clicking Submit without agreeing
   * is a SILENT no-op: no error, no toast, nothing — the button just does nothing and looks broken.
   * This is the exact "server/product validates something the UI does not surface properly" class of
   * defect the rest of this session has been hunting for; verified live below rather than asserted
   * from source alone.
   */
  test('Submit without agreeing to the terms silently does nothing (no error is shown) @ui', async ({
    page,
    signupPage,
  }) => {
    await reachCompanyDetails(signupPage, page);
    const mobile = freshMobile();
    await signupPage.fillCompanyDetails({
      companyName: `QA Fresh Co ${Date.now()}`,
      typeOfBusiness: 'QA Testing',
      pincode: testData.pinCode,
      area: 'Chennai',
      adminDesignation: 'Manager',
      preAdminDesignationId: `q${mobile.slice(-6)}`,
      businessUniqueName: `qz${mobile.slice(-6)}`,
    });
    await signupPage.continueToBusinessFinalStep();
    const idOutcome = await signupPage.businessKpostIdAvailability();
    test.skip(idOutcome === 'taken', 'the generated id collided — re-run');

    await page.getByPlaceholder('Enter Password').fill('QaBench@2026');
    await page.getByPlaceholder(/Enter Confirm Password/).fill('QaBench@2026');
    // Deliberately NOT checking the agree checkbox.

    const registerRequests: string[] = [];
    await page.route('**/adminRegistration/**', async (route) => {
      registerRequests.push(route.request().url());
      await route.continue();
    });

    const submitButton = page.getByRole('button', { name: /^Submit$/i });
    const disabledBeforeClick = await submitButton.isDisabled();
    await submitButton.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(2000);

    const anyErrorShown = await page
      .getByText(/agree|terms|accept|policy/i)
      .first()
      .isVisible()
      .catch(() => false);

    test.info().annotations.push({
      type: 'observed',
      description:
        `Submit button disabled attribute before click: ${disabledBeforeClick} | ` +
        `adminRegistration dispatched: ${registerRequests.length > 0} | ` +
        `an error/prompt about agreeing was shown: ${anyErrorShown}`,
    });

    // The one thing that must never happen regardless of how the UI signals it: a company must not
    // get created without the terms being agreed to.
    expect(
      registerRequests,
      'no registration request may be dispatched while the agree-checkbox is unchecked',
    ).toHaveLength(0);
  });
});

test.describe('KPost Business signup · full registration → login', { tag: '@ui' }, () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.skip(
    process.env.SIGNUP_UI_LIFECYCLE !== 'true',
    'creates a real, permanent company; set SIGNUP_UI_LIFECYCLE=true',
  );
  test.skip(
    process.env.OTP_TEST_GATEWAY !== 'true' || process.env.TEST_DB_MODE !== 'true',
    'the mobile OTP bypass code only validates on the confirmed OTP test gateway',
  );

  test('a Small Business account signs up (or is already registered) and then logs in @ui', async ({
    signupPage,
    loginPage,
    page,
  }) => {
    const mobileNumber = testData.signupBusinessUiMobile;
    const password = 'QaBench@2026';

    await signupPage.goto();
    await signupPage.chooseAccountType('Business');
    await signupPage.chooseBusinessCategory('Small');
    await signupPage.selectCountryLanguageDomain('India', 'English', 'kpost.in');

    const otpOutcome = await signupPage.requestMobileOtp(mobileNumber);
    // Confirmed from source: unlike Personal, Business's sendOTP does not pre-check mobile existence
    // before sending an OTP (the check is Personal-only), so 'already-exists' is not expected to fire
    // here — but the union member exists on the shared method signature, so it is still handled.
    test.skip(
      otpOutcome === 'already-exists',
      `${mobileNumber} was reported as already registered — unexpected on the Business path per ` +
        'source, but handled defensively; set a fresh QA_SIGNUP_BUSINESS_UI_MOBILE',
    );

    const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
    test.skip(
      otpEntryOutcome === 'invalid',
      'the OTP bypass code was rejected this run — likely transient; re-run',
    );

    await signupPage.fillBusinessPersonalDetails({
      firstName: 'QA',
      lastName: 'Business',
      gender: 'Male',
      dobDay: 15,
      dobMonth: 'June',
      dobYear: 1990,
    });
    await page.getByRole('button', { name: /^Continue$/i }).click({ force: true });

    const { companyNameOutcome, uniqueNameOutcome } = await signupPage.fillCompanyDetails({
      companyName: testData.signupBusinessCompanyName,
      typeOfBusiness: 'Software Services',
      pincode: testData.pinCode,
      area: 'Chennai',
      address1: 'QA Bench Address',
      adminDesignation: 'Manager',
      preAdminDesignationId: testData.signupBusinessDesignationId,
      businessUniqueName: testData.signupBusinessUniqueName,
    });
    test.skip(
      companyNameOutcome === 'taken',
      `"${testData.signupBusinessCompanyName}" is already registered — set a fresh QA_SIGNUP_BUSINESS_COMPANY_NAME`,
    );
    test.skip(
      uniqueNameOutcome === 'taken',
      `"${testData.signupBusinessUniqueName}" is already taken — set a fresh QA_SIGNUP_BUSINESS_UNIQUE_NAME`,
    );

    await signupPage.continueToBusinessFinalStep();
    const idOutcome = await signupPage.businessKpostIdAvailability();
    test.skip(
      idOutcome === 'taken',
      `${testData.signupBusinessDesignationId}.${testData.signupBusinessUniqueName} is taken — ` +
        'set a fresh QA_SIGNUP_BUSINESS_DESIGNATION_ID or QA_SIGNUP_BUSINESS_UNIQUE_NAME',
    );

    await signupPage.setPasswordAndSubmit(password);
    await signupPage.confirmSuccessAndGoToLogin();

    await expect(page, "signup's success modal lands on /login").toHaveURL(/\/login/, {
      timeout: 20_000,
    });

    // The full KPOST ID is only known now (dot-joined local part + whatever domain the dropdown
    // offered) — read it back from the success flow having completed, then log in with it.
    const fullKpostId = `${testData.signupBusinessDesignationId}.${testData.signupBusinessUniqueName}@kpost.in`;

    recordCreatedAccount({
      kpostId: fullKpostId,
      mobileNumber,
      source: 'signup-business.spec.ts (UI)',
      note: `Business (Small) registration driven end-to-end; company "${testData.signupBusinessCompanyName}"`,
    });

    await loginPage.login(fullKpostId, password);
    await expect(page, 'login reaches /home').toHaveURL(/\/home/, { timeout: 20_000 });
  });
});
