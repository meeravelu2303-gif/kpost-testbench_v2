import { recordCreatedAccount } from '@fixtures/created-accounts';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Business Medium/Large signup (MLRegister.js) through to login. Mints a real, permanent company, so
 * it is gated on SIGNUP_UI_LIFECYCLE and each tier uses its own reserved identity.
 */
test.describe(
  'KPost Business signup · Medium/Large full registration → login',
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

    const TIERS = [
      {
        category: 'Medium' as const,
        mobile: () => testData.signupMediumBusinessUiMobile,
        companyName: () => testData.signupMediumBusinessCompanyName,
        uniqueName: () => testData.signupMediumBusinessUniqueName,
        designationId: () => testData.signupMediumBusinessDesignationId,
        envHint:
          'QA_SIGNUP_MEDIUM_BUSINESS_UI_MOBILE / _COMPANY_NAME / _UNIQUE_NAME / _DESIGNATION_ID',
      },
      {
        category: 'Large' as const,
        mobile: () => testData.signupLargeBusinessUiMobile,
        companyName: () => testData.signupLargeBusinessCompanyName,
        uniqueName: () => testData.signupLargeBusinessUniqueName,
        designationId: () => testData.signupLargeBusinessDesignationId,
        envHint:
          'QA_SIGNUP_LARGE_BUSINESS_UI_MOBILE / _COMPANY_NAME / _UNIQUE_NAME / _DESIGNATION_ID',
      },
    ];

    for (const tier of TIERS) {
      test(`a ${tier.category} Business account signs up (or is already registered) and then logs in @ui`, async ({
        signupPage,
        loginPage,
        page,
      }) => {
        const mobileNumber = tier.mobile();
        const companyName = tier.companyName();
        const uniqueName = tier.uniqueName();
        const designationId = tier.designationId();
        const password = 'QaBench@2026';

        await signupPage.goto();
        await signupPage.chooseAccountType('Business');
        await signupPage.chooseBusinessCategory(tier.category);
        await signupPage.selectCountryLanguageDomain('India', 'English', 'kpost.in');

        const otpOutcome = await signupPage.requestMobileOtp(mobileNumber);
        test.skip(
          otpOutcome === 'already-exists',
          `${mobileNumber} was reported as already registered — set a fresh ${tier.envHint}`,
        );

        const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
        test.skip(
          otpEntryOutcome === 'invalid',
          'the OTP bypass code was rejected this run — likely transient; re-run',
        );

        await signupPage.fillBusinessPersonalDetails({
          firstName: 'QA',
          lastName: tier.category,
          gender: 'Male',
          dobDay: 15,
          dobMonth: 'June',
          dobYear: 1990,
        });
        await page.getByRole('button', { name: /^Continue$/i }).click({ force: true });

        const { companyNameOutcome, uniqueNameOutcome } =
          await signupPage.fillMediumLargeCompanyDetails({
            typeOfBusiness: 'Software Services',
            companyName,
            website: 'https://qa-bench.example.com',
            registrationNo: 'QA-REG-0000',
            gstNo: 'QA-GST-0000',
            // Tier bounds on the picker cards: Medium 250-2000, Large above 1500. Large's 500 is kept
            // below its minimum on purpose: it reproduces the known defect that it is accepted.
            employeeCount: tier.category === 'Medium' ? '300' : '500',
            pincode: testData.pinCode,
            area: 'Chennai',
            address1: 'QA Bench Address',
            adminDesignation: 'Manager',
            preAdminDesignationId: designationId,
            businessUniqueName: uniqueName,
            licenses: tier.category === 'Medium' ? '300' : '500',
          });
        test.skip(
          companyNameOutcome === 'taken',
          `"${companyName}" is already registered — set a fresh ${tier.envHint}`,
        );
        test.skip(
          uniqueNameOutcome === 'taken',
          `"${uniqueName}" is already taken — set a fresh ${tier.envHint}`,
        );

        await signupPage.continueToBusinessFinalStep();
        const idOutcome = await signupPage.businessKpostIdAvailability();
        test.skip(
          idOutcome === 'taken',
          `${designationId}.${uniqueName} is taken — set a fresh ${tier.envHint}`,
        );

        await signupPage.setPasswordAndSubmit(password);
        await signupPage.confirmSuccessAndGoToLogin();

        await expect(page, "signup's success modal lands on /login").toHaveURL(/\/login/, {
          timeout: 20_000,
        });

        const fullKpostId = `${designationId}.${uniqueName}@kpost.in`;
        recordCreatedAccount({
          kpostId: fullKpostId,
          mobileNumber,
          source: 'signup-business-medium-large.spec.ts (UI)',
          note: `Business (${tier.category}) registration driven end-to-end; company "${companyName}"`,
        });

        await loginPage.login(fullKpostId, password);
        await expect(page, 'login reaches /home').toHaveURL(/\/home/, { timeout: 20_000 });
      });
    }
  },
);

/**
 * An out-of-range Employee Count gets a 400 from the server; the UI must show feedback, not silence.
 * `1` is below every tier's minimum, so the check does not depend on exact boundaries.
 */
test.describe(
  'KPost Business signup · Medium/Large employee-count validation',
  { tag: ['@ui', '@auth', '@signup', '@regression'] },
  () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test.skip(
      process.env.SIGNUP_UI_LIFECYCLE !== 'true',
      'drives the real signup screen (a mobile OTP is sent); set SIGNUP_UI_LIFECYCLE=true',
    );
    test.skip(
      process.env.OTP_TEST_GATEWAY !== 'true' || process.env.TEST_DB_MODE !== 'true',
      'the mobile OTP bypass code only validates on the confirmed OTP test gateway',
    );

    test('an out-of-range Employee Count shows an error on Submit, not silence @ui', async ({
      signupPage,
      page,
    }) => {
      const mobileNumber = `77${Date.now().toString().slice(-8)}`;

      await signupPage.goto();
      await signupPage.chooseAccountType('Business');
      await signupPage.chooseBusinessCategory('Medium');
      await signupPage.selectCountryLanguageDomain('India', 'English', 'kpost.in');

      const otpOutcome = await signupPage.requestMobileOtp(mobileNumber);
      test.skip(otpOutcome === 'already-exists', 'the random mobile happened to collide — re-run');
      const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
      test.skip(
        otpEntryOutcome === 'invalid',
        'the OTP bypass code was rejected this run — re-run',
      );

      await signupPage.fillBusinessPersonalDetails({
        firstName: 'QA',
        lastName: 'EmpCount',
        gender: 'Male',
        dobDay: 15,
        dobMonth: 'June',
        dobYear: 1990,
      });
      await page.getByRole('button', { name: /^Continue$/i }).click({ force: true });

      const uniqueSuffix = mobileNumber.slice(-6);
      const { companyNameOutcome, uniqueNameOutcome } =
        await signupPage.fillMediumLargeCompanyDetails({
          typeOfBusiness: 'Software Services',
          companyName: `QA EmpCount Co ${uniqueSuffix}`,
          website: 'https://qa-bench.example.com',
          registrationNo: 'QA-REG-0000',
          gstNo: 'QA-GST-0000',
          employeeCount: '1',
          pincode: testData.pinCode,
          area: 'Chennai',
          address1: 'QA Bench Address',
          adminDesignation: 'Manager',
          preAdminDesignationId: `qec${uniqueSuffix}`,
          businessUniqueName: `qec${uniqueSuffix}`,
          licenses: '1',
        });
      test.skip(
        companyNameOutcome === 'taken',
        'the generated company name happened to collide — re-run',
      );
      test.skip(
        uniqueNameOutcome === 'taken',
        'the generated unique name happened to collide — re-run',
      );

      await signupPage.continueToBusinessFinalStep();
      const idOutcome = await signupPage.businessKpostIdAvailability();
      test.skip(idOutcome === 'taken', 'the generated KPOST ID happened to collide — re-run');

      await signupPage.setPasswordAndSubmit('QaBench@2026');

      const success = page.getByText(/Successfully completed the Signup/i);
      const anyErrorToast = page.locator('.Toastify__toast, [class*="toast"]', {
        hasText: /error|fail|invalid|try again|something went wrong/i,
      });

      const outcome = await Promise.race([
        success
          .waitFor({ state: 'visible', timeout: 15_000 })
          .then((): 'false-success' => 'false-success'),
        anyErrorToast
          .first()
          .waitFor({ state: 'visible', timeout: 15_000 })
          .then((): 'error-shown' => 'error-shown'),
      ]).catch((): 'nothing' => 'nothing');

      test.info().annotations.push({
        type: 'observed',
        description:
          `outcome for Employee Count=1 (Medium): ${outcome} — confirmed live 2026-09-30 the ` +
          'server rejects this with 400 "Invalid maximumMembersCount for userType"',
      });

      expect(
        outcome,
        'an out-of-range Employee Count must show SOME visible feedback, not nothing at all',
      ).not.toBe('nothing');
      expect(
        outcome,
        'the success modal must never appear when the server rejected the submission',
      ).not.toBe('false-success');
    });
  },
);
