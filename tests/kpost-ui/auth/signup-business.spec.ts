import { SignupPage } from '@pages/SignupPage';
import type { Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { recordCreatedAccount } from '@fixtures/created-accounts';
import { expect, test } from '@fixtures';
import { retryOrSkip } from '../../support/live-condition';

/**
 * Business (Small) signup: the category picker, Company Details validation, and one full registration.
 * The full flow mints a real, permanent company, so it is gated on SIGNUP_UI_LIFECYCLE and uses its
 * own reserved identity. One mobile may legitimately belong to several different companies.
 */
test.describe(
  'KPost signup · Business category picker (read-only)',
  { tag: ['@ui', '@auth', '@signup', '@regression'] },
  () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('all four categories are offered, and Multi-National is honestly unimplemented @ui', async ({
      page,
    }) => {
      const signup = new SignupPage(page);
      await signup.goto();
      await signup.chooseAccountType('Business');

      // Each card renders twice (a hidden mobile duplicate), so filter to the visible one.
      for (const category of ['Small', 'Medium', 'Large', 'Multi-National']) {
        await expect(
          page
            .locator('.category-contentBox-layout', { hasText: category })
            .filter({ visible: true }),
          `the ${category} category card is offered`,
        ).toBeVisible({ timeout: 15_000 });
      }

      // Multi-National has no flow behind it; it must say so with a toast, not go silent.
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
        page.locator('.react-select__input').first(),
        'the Business registration form opens with its Country/Language/Domain selects',
      ).toBeVisible({ timeout: 15_000 });
    });
  },
);

/**
 * Below the 992px breakpoint the app uses a separate legacy signup in MainSignup.js (#825).
 * Read-only: never submits a form.
 */
test.describe(
  'KPost signup · mobile viewport (below 992px)',
  { tag: ['@ui', '@auth', '@signup', '@regression'] },
  () => {
    test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 480, height: 900 } });

    test('Personal reaches its registration form on a mobile viewport @ui', async ({ page }) => {
      const signup = new SignupPage(page);
      await signup.goto();
      await page
        .getByText(/^Personal$/i)
        .filter({ visible: true })
        .first()
        .click();

      await expect(
        page.locator('.react-select__input').first(),
        'Personal signup reaches its Country/Language/Domain form on mobile',
      ).toBeVisible({ timeout: 15_000 });
    });

    test('Business (Small) reaches its registration form on a mobile viewport, matching Personal — #825 fixed @ui', async ({
      page,
    }) => {
      const signup = new SignupPage(page);
      await signup.goto();
      await page
        .getByText(/^Business$/i)
        .filter({ visible: true })
        .first()
        .click();
      await page.waitForTimeout(500);
      await page
        .getByText(/^Small$/i)
        .filter({ visible: true })
        .first()
        .click();
      await page.waitForTimeout(1500);

      await expect(
        page.locator('.react-select__input').first(),
        'Business signup reaches a registration form on mobile, matching Personal — #825',
      ).toBeVisible({ timeout: 10_000 });
    });
  },
);

test.describe(
  'KPost Business signup · field validation',
  { tag: ['@ui', '@auth', '@signup', '@regression'] },
  () => {
    test.skip(
      process.env.OTP_TEST_GATEWAY !== 'true' || process.env.TEST_DB_MODE !== 'true',
      'needs the OTP test gateway; set OTP_TEST_GATEWAY=true TEST_DB_MODE=true',
    );
    test.use({ storageState: { cookies: [], origins: [] } });

    function freshMobile(): string {
      return `78${Date.now().toString().slice(-8)}`;
    }

    /** Drives every screen up to (not including) Company Details, for the validation tests below. */
    async function reachCompanyDetails(signup: SignupPage, page: Page) {
      await signup.goto();
      await signup.chooseAccountType('Business');
      await signup.chooseBusinessCategory('Small');
      await signup.selectCountryLanguageDomain('India', 'English', 'kpost.in');

      const otpOutcome = await signup.requestMobileOtp(freshMobile());
      retryOrSkip(
        otpOutcome === 'already-exists',
        'the random mobile happened to collide — re-run',
      );
      const otpEntryOutcome = await signup.enterMobileOtp(testData.bypassOtp);
      retryOrSkip(
        otpEntryOutcome === 'invalid',
        'the OTP bypass code was rejected this run — re-run',
      );

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

      // testData.uniqueName is free, so only the accepted case is live; the taken case is stubbed below.
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
      // No taken unique name exists in test data, so the 409 is stubbed; the client's rendering is tested.
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
      await signupPage
        .fillCompanyDetails({
          companyName: `QA Fresh Co ${Date.now()}`,
          typeOfBusiness: 'QA Testing',
          pincode: testData.pinCode,
          area: 'Chennai',
          adminDesignation: 'Manager',
          preAdminDesignationId: `q${Date.now().toString().slice(-6)}`,
          businessUniqueName: 'anything',
        })
        .catch(() => undefined); // fillCompanyDetails' own outcome race isn't the point here

      await expect(
        page.getByText(/Business Short Unique Name already exists/i),
        'a server-side rejection of the unique name is shown to the user, not silently swallowed',
      ).toBeVisible({ timeout: 10_000 });
    });

    // SmallBusiness.js gates on agreeChecked inside onClick, not on `disabled`, so Submit without
    // agreeing is a silent no-op. Only "no registration is dispatched" is asserted.
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
      retryOrSkip(idOutcome === 'taken', 'the generated id collided — re-run');

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

      expect(
        registerRequests,
        'no registration request may be dispatched while the agree-checkbox is unchecked',
      ).toHaveLength(0);
    });
  },
);

test.describe(
  'KPost Business signup · full registration → login',
  { tag: ['@ui', '@auth', '@signup', '@regression'] },
  () => {
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
      // Business's sendOTP does not pre-check the mobile, so this is handled only defensively.
      test.skip(
        otpOutcome === 'already-exists',
        `${mobileNumber} was reported as already registered — unexpected on the Business path per ` +
          'source, but handled defensively; set a fresh QA_SIGNUP_BUSINESS_UI_MOBILE',
      );

      const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
      retryOrSkip(
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

      // The Business KPOST ID is the dot-joined designation id and unique name.
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
  },
);
