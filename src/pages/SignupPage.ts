import type { Page } from '@playwright/test';
import { test } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * The signup screen: account-type/domain selection plus the Personal and Business registration
 * write flows (the write flows are gated by their specs). react-select inputs are addressed by
 * class and form order (Country, Language, Domain), because the generated ids change between
 * deploys.
 */
export class SignupPage extends BasePage {
  readonly path = '/signup';

  /** Any open react-select menu's options. */
  private readonly options = this.page.locator('[class*="-option"]');

  constructor(page: Page) {
    super(page);
  }

  /**
   * The account-type chooser means "loaded"; the visible filter handles the shorter mobile heading.
   */
  async expectLoaded(): Promise<void> {
    await this.page
      .getByText(/Select Account Option/i)
      .filter({ visible: true })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** Chooses an account type; each card renders twice (a hidden mobile copy), so filter visible. */
  async chooseAccountType(type: 'Personal' | 'Business'): Promise<void> {
    await this.page
      .getByText(new RegExp(`^${type}$`, 'i'))
      .filter({ visible: true })
      .first()
      .click();
  }

  /**
   * The domain options for the selected account type; country and language must be chosen first.
   */
  async domainOptions(country: string, language: string): Promise<string[]> {
    await this.chooseFromSelect(0, country);
    await this.chooseFromSelect(1, language);

    await this.openSelect(2);
    const texts = await this.options.allInnerTexts();
    return texts.map((value) => value.trim()).filter(Boolean);
  }

  /** Opens the nth select and commits the option matching `filter`. */
  private async chooseFromSelect(index: number, filter: string): Promise<void> {
    await this.openSelect(index);
    // Type then Enter: react-select commits only the highlighted option, and text highlights one.
    await this.page.keyboard.type(filter);
    await this.settle();
    await this.page.keyboard.press('Enter');
    await this.settle();
  }

  /**
   * Chooses Gender and retries once until the Date of Birth field it gates is enabled (Firefox
   * sometimes misses the commit).
   */
  private async chooseGenderAndVerify(index: number, gender: string): Promise<void> {
    const dobField = this.page.getByPlaceholder('Select Date of Birth');
    for (let attempt = 1; attempt <= 2; attempt++) {
      await this.chooseFromSelect(index, gender);
      const enabled = await dobField
        .isEnabled({ timeout: attempt === 1 ? 3_000 : 10_000 })
        .catch(() => false);
      if (enabled) return;
    }
  }

  private async openSelect(index: number): Promise<void> {
    const input = this.page.locator('.react-select__input').nth(index);
    await input.waitFor({ state: 'attached', timeout: 20_000 });
    await input.click({ force: true });
    await this.settle();
  }

  /** A short pause for the react-select menu to mount or unmount (state-based waits were worse). */
  private async settle(): Promise<void> {
    await this.page.waitForTimeout(700);
  }

  // PERSONAL registration write flow (selectors from `PersonalSignup.js`).

  /** After `chooseAccountType('Personal')`: PersonalSignup's own Country/Language/Domain step. */
  async selectCountryLanguageDomain(
    country: string,
    language: string,
    domain: string,
  ): Promise<void> {
    await test.step(`Signup: country=${country} language=${language} domain=${domain}`, async () => {
      await this.chooseFromSelect(0, country);
      await this.chooseFromSelect(1, language);
      await this.chooseFromSelect(2, domain);
      await this.page.getByRole('button', { name: /^Continue$/i }).click();
    });
  }

  /**
   * Enters the mobile number and requests its OTP. `already-exists` (number already registered) is
   * a valid outcome on a re-run. The placeholder regex covers the mobile layout's different
   * wording.
   */
  async requestMobileOtp(mobileNumber: string): Promise<'sent' | 'already-exists'> {
    return test.step(`Signup: verify mobile ${mobileNumber}`, async () => {
      await this.page.getByPlaceholder(/Enter (Mobile Number|the Number)/i).fill(mobileNumber);
      await this.page
        .getByText(/^Verify$/i)
        .first()
        .click();
      const otpModal = this.page.getByText(/^Enter your OTP$/i);
      const alreadyExists = this.page.getByText(/Mobile number already exists/i);
      return Promise.race([
        otpModal.waitFor({ state: 'visible', timeout: 20_000 }).then((): 'sent' => 'sent'),
        alreadyExists
          .waitFor({ state: 'visible', timeout: 20_000 })
          .then((): 'already-exists' => 'already-exists'),
      ]);
    });
  }

  /** Types a too-short mobile number and clicks "Verify"; the app rejects it before any OTP. */
  async attemptVerifyWithInvalidMobile(mobileNumber: string): Promise<void> {
    await test.step(`Signup: verify an invalid mobile number ${mobileNumber}`, async () => {
      await this.page.getByPlaceholder('Enter Mobile Number').fill(mobileNumber);
      await this.page
        .getByText(/^Verify$/i)
        .first()
        .click();
      await this.page
        .getByText(/^Invalid Mobile Number$/i)
        .waitFor({ state: 'visible', timeout: 10_000 });
    });
  }

  /** Opens the Date of Birth calendar, if it is not open already. */
  async openDateOfBirthPicker(): Promise<void> {
    await this.page.getByPlaceholder('Select Date of Birth').click();
  }

  /** True when the day cell is disabled (DOB must be 18+ years ago); re-opens the picker. */
  async isDateOfBirthDayDisabled(day: number, month: string, year: number): Promise<boolean> {
    await this.openDateOfBirthPicker();
    await this.page.locator('.react-datepicker__year-select').selectOption(String(year));
    await this.page.locator('.react-datepicker__month-select').selectOption({ label: month });
    const cell = this.page
      .locator('.react-datepicker__day:not(.react-datepicker__day--outside-month)')
      .getByText(new RegExp(`^${day}$`), { exact: true })
      .first();
    const classAttr = (await cell.getAttribute('class')) ?? '';
    return classAttr.includes('react-datepicker__day--disabled');
  }

  /**
   * Types the 6-digit OTP into the per-digit boxes; the form auto-validates on the 6th digit.
   * Returns `invalid` when the app rejects the code, so a rejection is distinct from a hang.
   */
  async enterMobileOtp(otp: string): Promise<'verified' | 'invalid'> {
    return test.step('Signup: enter mobile OTP', async () => {
      // The title appears before the digit boxes accept input: wait for the first box, then settle.
      const firstBox = this.page.locator('#input_0');
      await firstBox.waitFor({ state: 'visible', timeout: 15_000 });
      await this.settle();
      await this.page.waitForTimeout(2000);
      const digits = otp.trim().split('').slice(0, 6);
      for (const [index, digit] of digits.entries()) {
        await this.page.locator(`#input_${index}`).fill(digit);
      }
      const modalClosed = this.page.getByText(/^Enter your OTP$/i);
      const rejected = this.page.getByText(/Invalid OTP\. Please enter the correct code/i);
      return Promise.race([
        modalClosed
          .waitFor({ state: 'hidden', timeout: 20_000 })
          .then((): 'verified' => 'verified'),
        rejected.waitFor({ state: 'visible', timeout: 20_000 }).then((): 'invalid' => 'invalid'),
      ]);
    });
  }

  /**
   * Name, gender, date of birth and pincode, including the "Pincode Details" modal. Gender is
   * select 0; Area is select 1 because Gender stays mounted behind the modal, and Confirm needs an
   * Area picked.
   */
  async fillPersonalDetails(details: {
    firstName: string;
    lastName: string;
    gender: 'Male' | 'Female' | 'Others';
    dobDay: number;
    dobMonth: string;
    dobYear: number;
    pincode: string;
    area: string;
  }): Promise<void> {
    await test.step('Signup: personal details', async () => {
      await this.page.getByPlaceholder('Enter the first name').fill(details.firstName);
      await this.page.getByPlaceholder('Enter the last name').fill(details.lastName);
      await this.chooseGenderAndVerify(0, details.gender);
      await this.chooseDateOfBirth(details.dobDay, details.dobMonth, details.dobYear);
      await this.page.getByPlaceholder('Enter postal pincode').fill(details.pincode);

      const pincodeModalTitle = this.page.getByText(/^Pincode Details$/i);
      await pincodeModalTitle.waitFor({ state: 'visible', timeout: 15_000 });
      await this.chooseFromSelect(1, details.area);
      await this.page.getByRole('button', { name: /^Confirm$/i }).click();
      // The modal's closing fade intercepts clicks, so wait for it to leave the DOM.
      await pincodeModalTitle.waitFor({ state: 'hidden', timeout: 15_000 });
    });
  }

  /**
   * Fills name, gender and DOB but not the pincode, so a test can type an invalid pincode itself.
   */
  async fillPersonalIdentityNoPincode(details: {
    firstName: string;
    lastName: string;
    gender: 'Male' | 'Female' | 'Others';
    dobDay: number;
    dobMonth: string;
    dobYear: number;
  }): Promise<void> {
    await test.step('Signup: personal identity (no pincode)', async () => {
      await this.page.getByPlaceholder('Enter the first name').fill(details.firstName);
      await this.page.getByPlaceholder('Enter the last name').fill(details.lastName);
      await this.chooseGenderAndVerify(0, details.gender);
      await this.chooseDateOfBirth(details.dobDay, details.dobMonth, details.dobYear);
    });
  }

  /** Types a value into the postal pincode field without waiting for the area-confirm modal. */
  async typePostalPincode(value: string): Promise<void> {
    await this.page.getByPlaceholder('Enter postal pincode').fill(value);
  }

  /** True once the Pincode Details area-confirm modal opens (only a VALID pincode triggers it). */
  async isPincodeDetailsModalVisible(timeoutMs = 4_000): Promise<boolean> {
    return this.page
      .getByText(/^Pincode Details$/i)
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs })
      .then(() => true)
      .catch(() => false);
  }

  /** Picks a date via the datepicker's month/year selects; `month` is the full name ("June"). */
  private async chooseDateOfBirth(day: number, month: string, year: number): Promise<void> {
    await this.page.getByPlaceholder('Select Date of Birth').click();
    const popup = this.page.locator('.react-datepicker-popper');
    await this.page.locator('.react-datepicker__year-select').selectOption(String(year));
    await this.page.locator('.react-datepicker__month-select').selectOption({ label: month });
    await this.page
      .locator('.react-datepicker__day:not(.react-datepicker__day--outside-month)')
      .getByText(new RegExp(`^${day}$`), { exact: true })
      .first()
      .click();
    // The closing popup can swallow the next click, so wait for it to hide.
    await popup.waitFor({ state: 'hidden', timeout: 15_000 });
  }

  /** "Continue" after OTP and pincode; forced, since a leftover datepicker cell can block it. */
  async continueToKpostId(): Promise<void> {
    await this.page.getByRole('button', { name: /^Continue$/i }).click({ force: true });
  }

  /** Types a Preferred KPOST ID and waits for the availability check; `taken` is valid. */
  async choosePreferredKpostId(local: string): Promise<'available' | 'taken'> {
    return test.step(`Signup: preferred KPOST ID ${local}`, async () => {
      await this.page.getByPlaceholder('Enter Preferred KPOST ID').fill(local);
      const available = this.page.getByText(/KpostID is Available/i);
      const taken = this.page.getByText(/This KpostID is already exists/i);
      return Promise.race([
        available
          .waitFor({ state: 'visible', timeout: 15_000 })
          .then((): 'available' => 'available'),
        taken.waitFor({ state: 'visible', timeout: 15_000 }).then((): 'taken' => 'taken'),
      ]);
    });
  }

  /** The state a Preferred KPOST ID settles into, including the 5-12 character length error. */
  async kpostIdValidationState(
    local: string,
  ): Promise<'available' | 'taken' | 'length-error' | 'none'> {
    return test.step(`Signup: KPOST ID validation state for "${local}"`, async () => {
      const field = this.page.getByPlaceholder('Enter Preferred KPOST ID');
      await field.fill('');
      await field.fill(local);
      const available = this.page.getByText(/KpostID is Available/i);
      const taken = this.page.getByText(/This KpostID is already exists/i);
      const lengthError = this.page.getByText(/between 5 and 12 characters/i);
      return Promise.race([
        available
          .waitFor({ state: 'visible', timeout: 10_000 })
          .then((): 'available' => 'available'),
        taken.waitFor({ state: 'visible', timeout: 10_000 }).then((): 'taken' => 'taken'),
        lengthError
          .waitFor({ state: 'visible', timeout: 10_000 })
          .then((): 'length-error' => 'length-error'),
        this.page.waitForTimeout(10_000).then((): 'none' => 'none'),
      ]);
    });
  }

  /** Opens "Get Suggestion from KPOST", returns the suggested ids and picks the first. */
  async pickKpostIdSuggestion(): Promise<{ suggestions: string[]; picked: string }> {
    return test.step('Signup: get KPOST ID suggestions and pick one', async () => {
      await this.page.getByText(/^Get Suggestion from KPOST$/i).click();
      const dialog = this.page.getByRole('dialog').filter({ hasText: /Suggestion from KPOST/i });
      const rows = dialog.locator('.Borber-Bottom.font-weight-bolder.Cursor_pointer');
      await rows.first().waitFor({ state: 'visible', timeout: 15_000 });
      const suggestions = (await rows.allInnerTexts()).map((s) => s.trim()).filter(Boolean);
      const picked = suggestions[0] ?? '';
      await rows.first().click();
      await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
      return { suggestions, picked };
    });
  }

  /** Password + Confirm Password (note: the live placeholder has a trailing space) + agree + Submit. */
  async setPasswordAndSubmit(password: string): Promise<void> {
    await test.step('Signup: password + agree + submit', async () => {
      await this.page.getByPlaceholder('Enter Password').fill(password);
      await this.page.getByPlaceholder(/Enter Confirm Password/).fill(password);
      await this.page.locator('input[type="checkbox"]').check();
      await this.page.getByRole('button', { name: /^Submit$/i }).click();
    });
  }

  /** Confirms the "Congratulations" success modal; its "Ok" is what navigates on to `/login`. */
  async confirmSuccessAndGoToLogin(): Promise<void> {
    await test.step('Signup: confirm success, continue to login', async () => {
      await this.page
        .getByText(/Successfully completed the Signup/i)
        .waitFor({ state: 'visible', timeout: 20_000 });
      await this.page.getByRole('button', { name: /^Ok$/i }).click();
    });
  }

  // BUSINESS (Small) registration (`SmallBusiness.js`); reuses Personal's shared steps.

  /** Clicks the chosen category card's own "Continue" (every card has one). */
  async chooseBusinessCategory(
    category: 'Small' | 'Medium' | 'Large' | 'Multi-National',
  ): Promise<void> {
    await test.step(`Signup: business category ${category}`, async () => {
      // Each card renders twice (a hidden mobile duplicate), so filter to visible.
      await this.page
        .locator('.category-contentBox-layout', { hasText: category })
        .filter({ visible: true })
        .getByText(/^Continue$/i)
        .click();
    });
  }

  /** Business admin's name, gender and DOB; the pincode comes later on Company Details. */
  async fillBusinessPersonalDetails(details: {
    firstName: string;
    lastName: string;
    gender: 'Male' | 'Female' | 'Others';
    dobDay: number;
    dobMonth: string;
    dobYear: number;
  }): Promise<void> {
    await test.step('Signup: business admin personal details', async () => {
      await this.page.getByPlaceholder('Enter the first name').fill(details.firstName);
      await this.page.getByPlaceholder('Enter the last name').fill(details.lastName);
      await this.chooseGenderAndVerify(0, details.gender);
      await this.chooseDateOfBirth(details.dobDay, details.dobMonth, details.dobYear);
    });
  }

  /**
   * Fills Company Details in tab order. Company Name and Business Short Unique Name are checked on
   * blur; both outcomes are returned. Area is select 1, as on Personal.
   */
  async fillCompanyDetails(details: {
    companyName: string;
    typeOfBusiness: string;
    pincode: string;
    area: string;
    address1?: string;
    address2?: string;
    adminDesignation: string;
    preAdminDesignationId: string;
    businessUniqueName: string;
  }): Promise<{
    companyNameOutcome: 'available' | 'taken';
    uniqueNameOutcome: 'available' | 'taken';
  }> {
    return test.step('Signup: company details', async () => {
      const companyNameField = this.page.getByPlaceholder('Enter Company Name');
      await companyNameField.fill(details.companyName);
      const companyTaken = this.page.getByText(/Company name already exists/i);
      await companyNameField.blur();
      const companyNameOutcome = await companyTaken
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then((): 'taken' => 'taken')
        .catch((): 'available' => 'available');

      await this.page.getByPlaceholder('Type of Business').fill(details.typeOfBusiness);
      await this.page.getByPlaceholder('Enter postal pincode').fill(details.pincode);

      const pincodeModalTitle = this.page.getByText(/^Pincode Details$/i);
      await pincodeModalTitle.waitFor({ state: 'visible', timeout: 15_000 });
      await this.chooseFromSelect(1, details.area);
      await this.page.getByRole('button', { name: /^Confirm$/i }).click();
      await pincodeModalTitle.waitFor({ state: 'hidden', timeout: 15_000 });

      if (details.address1)
        await this.page
          .getByPlaceholder('Enter the Business Address')
          .first()
          .fill(details.address1);
      if (details.address2)
        await this.page
          .getByPlaceholder('Enter the Business Address')
          .nth(1)
          .fill(details.address2);

      await this.chooseFromSelect(0, details.adminDesignation);
      await this.page
        .getByPlaceholder('Length 2-10 Characters')
        .first()
        .fill(details.preAdminDesignationId);

      const uniqueNameField = this.page.getByPlaceholder('Length 2-10 Characters').nth(1);
      await uniqueNameField.fill(details.businessUniqueName);
      const uniqueNameTaken = this.page.getByText(/Business Short Unique Name already exists/i);
      await uniqueNameField.blur();
      const uniqueNameOutcome = await uniqueNameTaken
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then((): 'taken' => 'taken')
        .catch((): 'available' => 'available');

      return { companyNameOutcome, uniqueNameOutcome };
    });
  }

  /**
   * Continues from Company Details; this derives and checks the KPOST ID shown on the next screen.
   */
  async continueToBusinessFinalStep(): Promise<void> {
    await test.step('Signup: continue from company details', async () => {
      await this.page.getByRole('button', { name: /^Continue$/i }).click({ force: true });
    });
  }

  /** Reads the read-only KPOST ID availability message on the final Business screen. */
  async businessKpostIdAvailability(): Promise<'available' | 'taken'> {
    return test.step('Signup: read business KPOST ID availability', async () => {
      const available = this.page.getByText(/KpostID is Available/i);
      const taken = this.page.getByText(/This KpostID is already exists/i);
      return Promise.race([
        available
          .waitFor({ state: 'visible', timeout: 15_000 })
          .then((): 'available' => 'available'),
        taken.waitFor({ state: 'visible', timeout: 15_000 }).then((): 'taken' => 'taken'),
      ]);
    });
  }

  // BUSINESS (Medium/Large) registration (`MLRegister.js`); only Company Details differs.

  /**
   * Medium/Large Company Details, filled in screen order (each field unlocks the next). Company
   * Name and Business Short Unique Name are checked on blur, as on Small.
   */
  async fillMediumLargeCompanyDetails(details: {
    typeOfBusiness: string;
    companyName: string;
    website: string;
    registrationNo: string;
    gstNo: string;
    employeeCount: string;
    pincode: string;
    area: string;
    address1?: string;
    address2?: string;
    adminDesignation: string;
    preAdminDesignationId: string;
    businessUniqueName: string;
    licenses: string;
  }): Promise<{
    companyNameOutcome: 'available' | 'taken';
    uniqueNameOutcome: 'available' | 'taken';
  }> {
    return test.step('Signup: Medium/Large company details', async () => {
      await this.page.getByPlaceholder('Type of Business').fill(details.typeOfBusiness);

      const companyNameField = this.page.getByPlaceholder('Enter Company Name');
      await companyNameField.fill(details.companyName);
      const companyTaken = this.page.getByText(/Company name already exists/i);
      await companyNameField.blur();
      const companyNameOutcome = await companyTaken
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then((): 'taken' => 'taken')
        .catch((): 'available' => 'available');

      await this.page.getByPlaceholder('Enter Website').fill(details.website);
      await this.page.getByPlaceholder('Registration No').fill(details.registrationNo);
      await this.page.getByPlaceholder('Enter GST No').fill(details.gstNo);
      await this.page.getByPlaceholder('Enter No of Employee').fill(details.employeeCount);
      await this.page.getByPlaceholder('Enter postal pincode').fill(details.pincode);

      const pincodeModalTitle = this.page.getByText(/^Pincode Details$/i);
      await pincodeModalTitle.waitFor({ state: 'visible', timeout: 15_000 });
      await this.chooseFromSelect(1, details.area);
      await this.page.getByRole('button', { name: /^Confirm$/i }).click();
      await pincodeModalTitle.waitFor({ state: 'hidden', timeout: 15_000 });

      if (details.address1)
        await this.page
          .getByPlaceholder('Enter the Business Address')
          .first()
          .fill(details.address1);
      if (details.address2)
        await this.page
          .getByPlaceholder('Enter the Business Address')
          .nth(1)
          .fill(details.address2);

      await this.chooseFromSelect(0, details.adminDesignation);
      await this.page
        .getByPlaceholder('Length 2-10 Characters')
        .first()
        .fill(details.preAdminDesignationId);

      const uniqueNameField = this.page.getByPlaceholder('Length 2-10 Characters').nth(1);
      await uniqueNameField.fill(details.businessUniqueName);
      const uniqueNameTaken = this.page.getByText(/Business Short Unique Name already exists/i);
      await uniqueNameField.blur();
      const uniqueNameOutcome = await uniqueNameTaken
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then((): 'taken' => 'taken')
        .catch((): 'available' => 'available');

      await this.page.getByPlaceholder('Enter No of User / Licenses').fill(details.licenses);

      return { companyNameOutcome, uniqueNameOutcome };
    });
  }
}
