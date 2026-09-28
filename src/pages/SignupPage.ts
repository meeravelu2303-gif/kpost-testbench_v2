import type { Page } from '@playwright/test';
import { test } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * The signup screen: account-type/domain selection (read-only, used by every spec) plus the full
 * PERSONAL registration write flow (`completeSignup()` and its steps), gated at the SPEC level —
 * `signup-login-lifecycle.spec.ts` is the only caller, behind `SIGNUP_UI_LIFECYCLE=true` +
 * `OTP_TEST_GATEWAY=true` + `TEST_DB_MODE=true`. `signup-domain.spec.ts` only ever calls
 * `chooseAccountType()`/`domainOptions()`, so it stays exactly as read-only as before this was added.
 *
 * ## Why the react-select handling lives here
 *
 * The form is built from `react-select`, whose menu is a detached portal that mounts on click and
 * unmounts on commit. Driving it needs a small settle between the click and the read, which is
 * exactly the kind of mechanical detail a page object exists to absorb — a spec asserting "Personal
 * offers one domain" should not also be responsible for knowing how the widget mounts.
 *
 * Selectors are taken from the live screen: the controls are `input[id^="react-select"]` in form
 * order (Country, Language, KPOST Domain) and options carry a `-option` class suffix. Addressing
 * them by ORDER rather than by the generated `react-select-N-input` ids is deliberate — those
 * numbers are per mounted instance and shift whenever another select appears anywhere on the page,
 * which would silently point this at the wrong control.
 */
export class SignupPage extends BasePage {
  readonly path = '/signup';

  /** Any open react-select menu's options. */
  private readonly options = this.page.locator(
    '[id^="react-select"][id$="-option"], [class*="-option"]',
  );

  constructor(page: Page) {
    super(page);
  }

  /** The account-type chooser is the screen's first step, so its presence means "loaded". */
  async expectLoaded(): Promise<void> {
    await this.page
      .getByText(/Select Account Option for Signup/i)
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** Chooses an account type from "Select Account Option for Signup". */
  async chooseAccountType(type: 'Personal' | 'Business'): Promise<void> {
    await this.page
      .getByText(new RegExp(`^${type}$`, 'i'))
      .first()
      .click();
  }

  /**
   * The domain options offered for the currently selected account type.
   *
   * Country and language are chosen first because the domain list depends on the country — reading
   * it beforehand returns an empty list and would assert nothing.
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
    /*
     * Typed, then Enter. react-select commits the *highlighted* option, and with no filter text
     * nothing is highlighted — Enter then does nothing, the menu stays open, and it swallows the
     * click meant for the next control.
     */
    await this.page.keyboard.type(filter);
    await this.settle();
    await this.page.keyboard.press('Enter');
    await this.settle();
  }

  private async openSelect(index: number): Promise<void> {
    const input = this.page.locator('input[id^="react-select"]').nth(index);
    await input.waitFor({ state: 'attached', timeout: 20_000 });
    await input.click({ force: true });
    await this.settle();
  }

  /**
   * A short pause for the menu to mount or unmount.
   *
   * A deliberate exception to "never sleep in a test": the thing being waited for is the *absence*
   * of a race inside a third-party widget, and every state-based alternative was tried and was
   * worse — waiting for options to appear fails when the click was swallowed, and waiting for them
   * to disappear fails when the previous menu is still animating. Confined to the page object so no
   * spec has to know about it.
   */
  private async settle(): Promise<void> {
    await this.page.waitForTimeout(700);
  }

  // ============================================================================================
  // PERSONAL registration — the write flow. NEEDS-LIVE-TUNING: built from the real component
  // (`PersonalSignup.js` in KPOST_REACTJS_2023_V1) rather than a codegen recording, since a full
  // signup mints a real account and cannot be rehearsed cheaply. Selectors are cited against that
  // source below; remove this note once a run has gone green and confirmed them on live.
  // ============================================================================================

  /** After `chooseAccountType('Personal')`: PersonalSignup's own Country/Language/Domain step. */
  async selectCountryLanguageDomain(country: string, language: string, domain: string): Promise<void> {
    await test.step(`Signup: country=${country} language=${language} domain=${domain}`, async () => {
      await this.chooseFromSelect(0, country);
      await this.chooseFromSelect(1, language);
      await this.chooseFromSelect(2, domain);
      await this.page.getByRole('button', { name: /^Continue$/i }).click();
    });
  }

  /**
   * Enters the mobile number and requests its OTP (`PersonalSignup.js`'s "Verify" link).
   *
   * The product checks existence BEFORE sending an OTP: `already-exists` means the number is
   * already registered (a toast, no OTP modal) — a valid outcome on a re-run, not a failure.
   */
  async requestMobileOtp(mobileNumber: string): Promise<'sent' | 'already-exists'> {
    return test.step(`Signup: verify mobile ${mobileNumber}`, async () => {
      await this.page.getByPlaceholder('Enter Mobile Number').fill(mobileNumber);
      await this.page.getByText(/^Verify$/i).first().click();
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

  /**
   * Types the 6-digit OTP into the modal's per-digit boxes (`id="input_0"`..`"input_5"`, set by
   * `PersonalSignup.js` from the `Input` component's `id` prop). The form auto-validates on the
   * 6th digit and closes the modal on success — no separate submit button to click.
   */
  async enterMobileOtp(otp: string): Promise<void> {
    await test.step('Signup: enter mobile OTP', async () => {
      const digits = otp.trim().split('').slice(0, 6);
      for (const [index, digit] of digits.entries()) {
        await this.page.locator(`#input_${index}`).fill(digit);
      }
      await this.page.getByText(/^Enter your OTP$/i).waitFor({ state: 'hidden', timeout: 15_000 });
    });
  }

  /**
   * The rest of PersonalSignup's second screen: name, gender, date of birth, postal pincode — up to
   * and including the auto-opened "Pincode Details" confirm modal a valid 6-digit pincode triggers.
   *
   * Gender is the only react-select mounted on this screen (Country/Language/Domain from the
   * previous screen have unmounted), so it is `chooseFromSelect(0, ...)` here, not index 2.
   */
  async fillPersonalDetails(details: {
    firstName: string;
    lastName: string;
    gender: 'Male' | 'Female' | 'Others';
    dobDay: number;
    dobMonth: string;
    dobYear: number;
    pincode: string;
  }): Promise<void> {
    await test.step('Signup: personal details', async () => {
      await this.page.getByPlaceholder('Enter the first name').fill(details.firstName);
      await this.page.getByPlaceholder('Enter the last name').fill(details.lastName);
      await this.chooseFromSelect(0, details.gender);
      await this.chooseDateOfBirth(details.dobDay, details.dobMonth, details.dobYear);
      await this.page.getByPlaceholder('Enter postal pincode').fill(details.pincode);

      await this.page
        .getByText(/^Pincode Details$/i)
        .waitFor({ state: 'visible', timeout: 15_000 });
      await this.page.getByRole('button', { name: /^Confirm$/i }).click();
    });
  }

  /**
   * Drives the `react-datepicker` popup (`DateSelect.js`): `showMonthDropdown` + `showYearDropdown`
   * + `dropdownMode="select"` render real `<select>` elements for month/year rather than arrow
   * pagers — the stable part of this widget's DOM across versions.
   */
  private async chooseDateOfBirth(day: number, month: string, year: number): Promise<void> {
    await this.page.getByPlaceholder('Select Date of Birth').click();
    await this.page.locator('.react-datepicker__year-select').selectOption(String(year));
    await this.page.locator('.react-datepicker__month-select').selectOption(month);
    await this.page
      .locator('.react-datepicker__day:not(.react-datepicker__day--outside-month)')
      .getByText(new RegExp(`^${day}$`), { exact: true })
      .first()
      .click();
  }

  /** The "Continue" button gated on `ValidData && otpValidationStatus` (mobile OTP + pincode confirm). */
  async continueToKpostId(): Promise<void> {
    await this.page.getByRole('button', { name: /^Continue$/i }).click();
  }

  /**
   * The third screen's Preferred KPOST ID field — a plain `<input>`, not the `Input` component, but
   * it still carries the placeholder used to locate it. Availability is checked live (debounced);
   * `taken` is a valid outcome (the local part collided), not a failure.
   */
  async choosePreferredKpostId(local: string): Promise<'available' | 'taken'> {
    return test.step(`Signup: preferred KPOST ID ${local}`, async () => {
      await this.page.getByPlaceholder('Enter Preferred KPOST ID').fill(local);
      const available = this.page.getByText(/KpostID is Available/i);
      const taken = this.page.getByText(/This KpostID is already exists/i);
      return Promise.race([
        available.waitFor({ state: 'visible', timeout: 15_000 }).then((): 'available' => 'available'),
        taken.waitFor({ state: 'visible', timeout: 15_000 }).then((): 'taken' => 'taken'),
      ]);
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
}
