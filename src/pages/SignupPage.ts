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
 * Selectors are taken from the live screen: the controls are `.react-select__input` in form order
 * (Country, Language, KPOST Domain) and options carry a `-option` class suffix. Addressing them by
 * ORDER rather than by id is deliberate — a deploy on 2026-09-30 changed the id scheme from
 * react-select's own generated `react-select-N-input` to a custom `kpost-select-rN` (confirmed live:
 * `id="kpost-select-r0"`, `aria-label="Country"` — an accessibility improvement, not a regression),
 * which broke every id-based locator here overnight. The CLASS name (`react-select__input`, from the
 * library itself) is what's actually stable across a markup change like this; matching by that plus
 * position is now the resilient choice, not just the original one.
 */
export class SignupPage extends BasePage {
  readonly path = '/signup';

  /** Any open react-select menu's options — class-based (see the class comment above for why). */
  private readonly options = this.page.locator('[class*="-option"]');

  constructor(page: Page) {
    super(page);
  }

  /**
   * The account-type chooser is the screen's first step, so its presence means "loaded". Below the
   * 992px desktop/mobile breakpoint the heading text is shorter ("Select Account Option", no "for
   * Signup" suffix) and the desktop copy is a hidden `display:none` duplicate — `.filter({ visible:
   * true })` on the shared substring handles both viewports.
   */
  async expectLoaded(): Promise<void> {
    await this.page
      .getByText(/Select Account Option/i)
      .filter({ visible: true })
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
    const input = this.page.locator('.react-select__input').nth(index);
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
   * Types a mobile number that is NOT 10 digits and clicks "Verify". `Mobile()`'s own input mask
   * (`/^\d{0,10}$/`) already blocks non-digit characters and anything past 10 digits as they are
   * typed, so this only usefully exercises a SHORT digit string — `sendOTP()` checks the length
   * itself before ever calling the network (`if (enteredNumber.length !== 10) { toast.error(...) }`),
   * so neither the OTP modal nor an "already exists" toast can appear here; this is the third, purely
   * client-side outcome those two don't cover.
   */
  async attemptVerifyWithInvalidMobile(mobileNumber: string): Promise<void> {
    await test.step(`Signup: verify an invalid mobile number ${mobileNumber}`, async () => {
      await this.page.getByPlaceholder('Enter Mobile Number').fill(mobileNumber);
      await this.page.getByText(/^Verify$/i).first().click();
      await this.page
        .getByText(/^Invalid Mobile Number$/i)
        .waitFor({ state: 'visible', timeout: 10_000 });
    });
  }

  /** Opens the Date of Birth calendar, if it is not open already. */
  async openDateOfBirthPicker(): Promise<void> {
    await this.page.getByPlaceholder('Select Date of Birth').click();
  }

  /**
   * True when the given day/month/year cell carries react-datepicker's own disabled class —
   * `DateSelect.js`'s `maxDate` (18 years before today) should make any day within that window
   * unselectable.
   *
   * Re-opens the picker itself on every call rather than assuming a prior call left it open and in
   * the right month/year: live-verified 2026-09-28, calling this twice in a row without an explicit
   * reopen between checks was flaky (the year `<select>` intermittently had no options yet).
   */
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
   * Types the 6-digit OTP into the modal's per-digit boxes (`id="input_0"`..`"input_5"`, set by
   * `PersonalSignup.js` from the `Input` component's `id` prop). The form auto-validates on the
   * 6th digit and closes the modal on success — no separate submit button to click.
   *
   * Returns `invalid` rather than throwing when the app itself rejects the code (its own
   * `validateOTP` call, not one this bench controls — the OTP box's auto-submit is a black box
   * from here), so a caller can tell "the code was rejected" apart from a genuine hang.
   *
   * Live-verified 2026-09-28: a WRONGLY suspected bug was filed and retracted here (#721, closed
   * INVALID) — `validateOTP` seemed to reject even the correct bypass code. Two wrong theories were
   * ruled out first (server load from a concurrent API sweep; the `sendDate` field itself — a
   * byte-identical request succeeded when sent standalone). The real cause: this method filled the
   * OTP digits too soon after the modal's title became visible, before the digit boxes were actually
   * ready to receive input. See the settle below.
   */
  async enterMobileOtp(otp: string): Promise<'verified' | 'invalid'> {
    return test.step('Signup: enter mobile OTP', async () => {
      /*
       * Live-verified 2026-09-28: the modal's TITLE becomes visible slightly before its digit boxes
       * are ready to receive input reliably — filling them immediately after the title appears was
       * the actual cause of #721 (retracted), not `sendDate` or server load. Waiting for the first
       * box to actually be visible+enabled (not just a fixed delay) is the real readiness signal; a
       * short settle after it closes the remaining gap — a fixed 3s alone still occasionally raced.
       */
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
   * The rest of PersonalSignup's second screen: name, gender, date of birth, postal pincode — up to
   * and including the auto-opened "Pincode Details" confirm modal a valid 6-digit pincode triggers.
   *
   * Gender is the only react-select mounted on this screen (Country/Language/Domain from the
   * previous screen have unmounted), so it is `chooseFromSelect(0, ...)` here, not index 2.
   *
   * Live-verified 2026-09-28: the Pincode modal's "Confirm" stays disabled until an Area is picked —
   * it only auto-selects when the pincode has exactly one area, which most real pincodes (including
   * the default 600001, with 6) do not. Gender's select is still mounted behind the modal, so Area
   * is `chooseFromSelect(1, ...)`, not `0`.
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
      await this.chooseFromSelect(0, details.gender);
      await this.chooseDateOfBirth(details.dobDay, details.dobMonth, details.dobYear);
      await this.page.getByPlaceholder('Enter postal pincode').fill(details.pincode);

      const pincodeModalTitle = this.page.getByText(/^Pincode Details$/i);
      await pincodeModalTitle.waitFor({ state: 'visible', timeout: 15_000 });
      await this.chooseFromSelect(1, details.area);
      await this.page.getByRole('button', { name: /^Confirm$/i }).click();
      /*
       * Live-verified 2026-09-28: clicking "Continue" (the next step) immediately after this modal's
       * own "Confirm" is flaky — the modal's closing animation (a Bootstrap `.fade`) briefly
       * intercepts pointer events even after "Confirm" resolves. Waiting for the title to actually
       * leave the DOM avoids the race instead of relying on Playwright's click-retry to paper over it.
       */
      await pincodeModalTitle.waitFor({ state: 'hidden', timeout: 15_000 });
    });
  }

  /**
   * Drives the `react-datepicker` popup (`DateSelect.js`): `showMonthDropdown` + `showYearDropdown`
   * + `dropdownMode="select"` render real `<select>` elements for month/year rather than arrow
   * pagers — the stable part of this widget's DOM across versions.
   *
   * Live-verified 2026-09-28: the month `<option>`s carry the FULL name as their label ("June", not
   * "Jun") and a 0-indexed numeric string as their value ("0".."11") — `selectOption` matches by
   * value first, so passing a month name only works via `{ label }`, and only the full name matches.
   */
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
    /*
     * Live-verified 2026-09-28: picking a day closes the calendar, but not instantly — the still-
     * closing popup can sit over the "Continue" button and swallow that click. Same race as the
     * Pincode modal above; waited out the same way instead of leaning on click-retry.
     */
    await popup.waitFor({ state: 'hidden', timeout: 15_000 });
  }

  /**
   * The "Continue" button gated on `ValidData && otpValidationStatus` (mobile OTP + pincode confirm).
   *
   * `force: true`: live-verified 2026-09-28, a leftover datepicker day cell intermittently still
   * intercepts pointer events here even after `chooseDateOfBirth` confirms its popup hidden — the
   * same category of overlay race `openSelect` above already forces through for react-select.
   */
  async continueToKpostId(): Promise<void> {
    await this.page.getByRole('button', { name: /^Continue$/i }).click({ force: true });
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

  // ============================================================================================
  // BUSINESS (Small) registration — a separate multi-screen flow from Personal, driven from
  // `SmallBusiness.js` in KPOST_REACTJS_2023_V1. After `chooseAccountType('Business')` the screen
  // shows a CATEGORY picker (Small/Medium/Large/Multi-National) before any registration form mounts;
  // only "Small" is wired to a real flow today (Medium/Large use a much larger, separately-built
  // component; Multi-National is unimplemented and just toasts "in progress"). Country/Language/
  // Domain, the mobile-OTP mechanism, the date-of-birth picker, the password policy, and the success
  // modal are ALL identical to Personal's (same components/selectors) — only reused, not redefined
  // here. NEEDS-LIVE-TUNING to the same degree as the Personal write flow: built from source, not a
  // codegen recording, since a full run mints a real, permanent company (see adminRegistration's own
  // `global` side-effect note in the API definitions).
  // ============================================================================================

  /**
   * The category picker shown after choosing "Business" (`MainSignup.js`'s `signupBoolean.category`
   * screen). Each card is `.category-contentBox-layout` with a `.category-title` naming it; the click
   * target is that SAME card's own "Continue" span, scoped by card so the right one is hit among the
   * (currently 4) identically-labelled "Continue" controls on this screen.
   */
  async chooseBusinessCategory(category: 'Small' | 'Medium' | 'Large' | 'Multi-National'): Promise<void> {
    await test.step(`Signup: business category ${category}`, async () => {
      // The screen renders each category card TWICE (a hidden, `display:none` responsive/mobile
      // duplicate alongside the visible one) — `.filter({ visible: true })` narrows to the one shown.
      await this.page
        .locator('.category-contentBox-layout', { hasText: category })
        .filter({ visible: true })
        .getByText(/^Continue$/i)
        .click();
    });
  }

  /**
   * Business's own second screen (post country/language/domain): the same name/gender/DOB fields as
   * Personal, but NO Postal Pincode/Area here — Business collects pincode later, on the Company
   * Details screen, instead (`updateValidity()` forces `isPinCodeValid = true` for Business on this
   * screen). Gender is still the only react-select mounted here, so `chooseFromSelect(0, …)`.
   */
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
      await this.chooseFromSelect(0, details.gender);
      await this.chooseDateOfBirth(details.dobDay, details.dobMonth, details.dobYear);
    });
  }

  /**
   * The Company Details screen (`SmallBusiness.js`'s `smallBusiness` step) — Business-only, no
   * Personal equivalent. Company Name and Business Short Unique Name are each existence-checked
   * live on BLUR; this fills every field in tab order (so each blur fires naturally) and returns
   * both availability outcomes plus the pincode-modal's area-confirm handling (identical widget to
   * Personal's — live-verified 2026-09-29: Gender's select from the PREVIOUS screen is still mounted
   * behind this modal too, same as Personal's, so Area is `chooseFromSelect(1, …)` here, not `0`).
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
  }): Promise<{ companyNameOutcome: 'available' | 'taken'; uniqueNameOutcome: 'available' | 'taken' }> {
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

      if (details.address1) await this.page.getByPlaceholder('Enter the Business Address').first().fill(details.address1);
      if (details.address2) await this.page.getByPlaceholder('Enter the Business Address').nth(1).fill(details.address2);

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
   * Advances from Company Details to the final screen. Unlike Personal, the KPOST ID isn't typed
   * here — clicking Continue itself derives `preAdminDesignationId.businessUniqueName` and checks its
   * availability, which the NEXT screen then displays read-only.
   */
  async continueToBusinessFinalStep(): Promise<void> {
    await test.step('Signup: continue from company details', async () => {
      await this.page.getByRole('button', { name: /^Continue$/i }).click({ force: true });
    });
  }

  /**
   * Reads the passively-displayed KPOST ID availability message on the final screen (the field
   * itself is `readOnly` here — availability was already checked when Continue was clicked on the
   * previous screen). Same message text as Personal's `choosePreferredKpostId`.
   */
  async businessKpostIdAvailability(): Promise<'available' | 'taken'> {
    return test.step('Signup: read business KPOST ID availability', async () => {
      const available = this.page.getByText(/KpostID is Available/i);
      const taken = this.page.getByText(/This KpostID is already exists/i);
      return Promise.race([
        available.waitFor({ state: 'visible', timeout: 15_000 }).then((): 'available' => 'available'),
        taken.waitFor({ state: 'visible', timeout: 15_000 }).then((): 'taken' => 'taken'),
      ]);
    });
  }

  // ============================================================================================
  // BUSINESS (Medium/Large) registration — a THIRD, separate flow from both Personal and Small
  // Business, driven from `MLRegister.js` in KPOST_REACTJS_2023_V1 (~2,100 lines — a materially
  // bigger component, not a variant of `SmallBusiness.js`). Reached the same way as Small
  // (`chooseAccountType('Business')` then `chooseBusinessCategory('Medium' | 'Large')`) and its
  // Country/Language/Domain step, Gender/DOB step, mobile-OTP mechanism, and final KPOST-ID/password
  // screen are ALL byte-identical in markup to Small's (confirmed live 2026-09-30: same
  // `.react-select__input` selects, same `#input_0`..`#input_5` OTP boxes, same "Enter Password"/
  // "Enter Confirm Password " placeholders) — so `selectCountryLanguageDomain`, `requestMobileOtp`,
  // `enterMobileOtp`, `fillBusinessPersonalDetails`, `continueToBusinessFinalStep`,
  // `businessKpostIdAvailability`, `setPasswordAndSubmit` and `confirmSuccessAndGoToLogin` are all
  // reused as-is. Only the Company Details step differs — it has 5 extra fields Small does not
  // collect (Website, Registration No, GST No, No of Employee, No of Licenses) — so that is the one
  // new method this section adds.
  //
  // For India (the only country this bench ever signs up as), mobile OTP is the verification
  // channel exactly like Small/Personal — `MLRegister.js` only switches to an email-OTP channel for
  // non-India signups, which is out of scope here.
  // ============================================================================================

  /**
   * The Medium/Large Company Details screen (`MLRegister.js`'s `smallBusiness` step — the flag name
   * is a leftover from a copy/paste of `SmallBusiness.js`, not a sign the two components share code).
   * Fields are progressively `isDisabled` until the previous one is filled, so this fills them in the
   * screen's own order. Company Name and Business Short Unique Name are each existence-checked live
   * on BLUR, same mechanism as Small's `fillCompanyDetails` — GST No and No of Employee have no such
   * check (confirmed from source: no blur handler, just `setGstNo`/`setEmployeeCount`).
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
  }): Promise<{ companyNameOutcome: 'available' | 'taken'; uniqueNameOutcome: 'available' | 'taken' }> {
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

      if (details.address1) await this.page.getByPlaceholder('Enter the Business Address').first().fill(details.address1);
      if (details.address2) await this.page.getByPlaceholder('Enter the Business Address').nth(1).fill(details.address2);

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
