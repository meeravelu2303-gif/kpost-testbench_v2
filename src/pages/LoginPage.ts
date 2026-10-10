import { expect, type Page, test } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * The KPOST login screen, modelled on the real component (`src/components/auth/Login.js` in the
 * KPOST_REACTJS_2023_V1 repo) rather than a guessed layout.
 *
 * It is a **two-step** flow, which the tests have to know about:
 *
 *   Step 1  choose a country, type a KPOST ID or mobile number, press Submit. The app calls
 *           `fetchUserDetails` and, if the id exists, shows a name card and advances to step 2.
 *           An unknown id raises the toast "The KPOST ID / Mobile Number doesn't exist."
 *   Step 2  type the password, press Login. Success navigates to `/home`; a wrong password shows an
 *           inline error under the field (the server's message, e.g. "Invalid Credential").
 *
 * The component ships **no `data-testid` hooks**, so every locator here is by role, label or text —
 * more brittle than an id, and the reason `docs/generated/live-endpoints.md` flags test-ids as a UI-bench
 * prerequisite. Each locator notes what it is anchored to so a UI change points here.
 */
export class LoginPage extends BasePage {
  readonly path = '/login';

  // Step 1 — the country select is a react-select; its text box carries this placeholder.
  readonly countrySelect = this.page.getByText(/Search country/i);
  // KPOST ID / mobile input: `id="username"`, placeholder "Enter KPOST ID / Mobile number".
  readonly loginIdInput = this.page.locator('#username');
  readonly submitButton = this.page.getByRole('button', { name: /^Submit$/i });
  // The domain autocomplete portal that appears while typing an id — it overlays Submit.
  readonly domainList = this.page.locator('.login__domain-list');

  // Step 2 — the password field (type=password) and the Login button.
  readonly passwordInput = this.page.locator('input[type="password"]');
  readonly loginButton = this.page.getByRole('button', { name: /^Login$/i });
  // Inline validation message under the password field (`.login__error-msg`).
  readonly inlineError = this.page.locator('.login__error-msg');

  constructor(page: Page) {
    super(page);
  }

  async expectLoaded(): Promise<void> {
    await this.waitForCountryReady();
  }

  /**
   * Wait for the id field to become enabled — it is disabled until the country list loads.
   *
   * That list comes from an endpoint that rate-limits after repeated fresh loads (worst in the
   * slower engines), so a first wait can time out even though the page is fine. One reload gives the
   * throttle a moment to clear and reloads the country list, which turns a flaky failure into a
   * reliable pass across Chromium, Firefox and WebKit.
   */
  private async waitForCountryReady(): Promise<void> {
    try {
      await expect(this.loginIdInput).toBeEnabled({ timeout: 20_000 });
    } catch {
      await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect(
        this.loginIdInput,
        'id field enabled once the country list loads (after one reload)',
      ).toBeEnabled({ timeout: 30_000 });
    }
  }

  /** Step 1 only: enter an id and submit, without a password. */
  async enterLoginId(loginId: string): Promise<void> {
    await test.step(`Enter KPOST ID ${loginId}`, async () => {
      await this.waitForCountryReady();

      /*
       * Typing an id with `@` pops a domain-autocomplete portal that overlays the Submit button, so
       * clicking Submit is unreliable. The app submits step 1 on Enter in the id field
       * (`handleKeyPress` -> `checkIsNumber`), which bypasses the overlay entirely — that is what a
       * user does too. Escape first, to dismiss the portal, then Enter.
       */
      await this.loginIdInput.fill(loginId);
      await this.loginIdInput.press('Escape');
      await this.loginIdInput.press('Enter');
    });
  }

  /** The whole flow: id -> Submit -> (fetchUserDetails) -> password -> Login. */
  async login(loginId: string, password: string): Promise<void> {
    await test.step(
      `Log in as ${loginId}`,
      async () => {
        await this.enterLoginId(loginId);
        // Step 2 appears after fetchUserDetails resolves; the password field can be slow.
        await this.passwordInput.waitFor({ state: 'visible', timeout: 20_000 });
        await this.passwordInput.fill(password);
        await expect(this.loginButton).toBeEnabled();
        await this.loginButton.click();
      },
      { box: true },
    );
  }

  // ============================================================================================
  // Forgot-password — the full reset flow (`Login.js`'s `handleForgetPassword` /
  // `handleVerifyOTP` / `passwordChange`). NEEDS-LIVE-TUNING to the same degree as the Signup
  // write flow: built from source, not a codegen recording.
  //
  // IMPORTANT, confirmed from source (2026-09-30): clicking "Forgot Password ?" itself fires a REAL
  // OTP send (`ForgetPasswordSentOTP`) immediately — it is NOT deferred to some later "submit" step.
  // Only run this under the same OTP_TEST_GATEWAY + TEST_DB_MODE gate as every other OTP-driven flow
  // in this bench, and only ever against the dedicated `QA_FORGOT_PASSWORD_KPOST_ID` spare account —
  // never the shared `QA_KPOST_ID` every other suite logs in with (see `test-data.config.ts`'s own
  // doc comment on this exact hazard).
  // ============================================================================================

  /** The Forgot-Password modal's OTP-entry section: `#input_0`..`#input_5`, same as every other. */
  readonly forgotPasswordOtpFirstBox = this.page.locator('#input_0');
  /** The New-Password section — no `placeholder` attribute on either field (labeled by adjacent
   * text instead), so these are addressed by type + order within the modal, scoped via `.modal`. */
  private readonly forgotPasswordModal = this.page.locator('.modal, [role="dialog"]').filter({
    has: this.page.getByText(/^Forgot Password$/i),
  });

  /**
   * Step 1 -> id -> password step -> click "Forgot Password ?" -> the OTP modal opens. This ALONE
   * already dispatches a real OTP send (see the class doc comment above).
   */
  async requestPasswordResetOtp(loginId: string): Promise<void> {
    await test.step(`Forgot password: request OTP for ${loginId}`, async () => {
      await this.enterLoginId(loginId);
      await this.passwordInput.waitFor({ state: 'visible', timeout: 20_000 });
      await this.page
        .getByText(/Forgot Password/i)
        .first()
        .click();
      await this.forgotPasswordOtpFirstBox.waitFor({ state: 'visible', timeout: 15_000 });
    });
  }

  /**
   * Types the 6-digit OTP; the form auto-submits on the 6th digit (`handleVerifyOTP`) and, on
   * success, transitions straight to the New Password section — no separate confirm click.
   */
  async enterPasswordResetOtp(otp: string): Promise<'verified' | 'invalid'> {
    return test.step('Forgot password: enter OTP', async () => {
      await this.forgotPasswordOtpFirstBox.waitFor({ state: 'visible', timeout: 15_000 });
      const digits = otp.trim().split('').slice(0, 6);
      for (const [index, digit] of digits.entries()) {
        await this.page.locator(`#input_${index}`).fill(digit);
      }
      const newPasswordSection = this.page.getByText(/^Enter Your New Password$/i);
      const stillOtp = this.forgotPasswordOtpFirstBox;
      return Promise.race([
        newPasswordSection
          .waitFor({ state: 'visible', timeout: 20_000 })
          .then((): 'verified' => 'verified'),
        // No dedicated "Invalid OTP" text is rendered here (unlike Signup's) — the OTP boxes simply
        // stay put with nothing to enter next. Treat "still on the OTP screen after a real wait" as
        // the invalid case.
        this.page
          .waitForTimeout(8_000)
          .then(() => stillOtp.isVisible())
          .then((stillThere): 'invalid' | never => {
            if (stillThere) return 'invalid';
            throw new Error('left the OTP screen without reaching New Password — unexpected state');
          }),
      ]);
    });
  }

  /**
   * The New Password / Confirm New Password screen. Both fields lack a `placeholder` attribute
   * (labeled by adjacent text instead — live-verified 2026-09-30), so they are addressed by
   * `input[type="password"]` order, scoped to this modal specifically so a stray password field
   * elsewhere on the page can never be matched instead.
   */
  async submitNewPassword(newPassword: string): Promise<void> {
    await test.step('Forgot password: submit new password', async () => {
      const modal = this.forgotPasswordModal;
      const fields = modal.locator('input[type="password"]');
      await fields.nth(0).waitFor({ state: 'visible', timeout: 15_000 });
      await fields.nth(0).fill(newPassword);
      await fields.nth(1).fill(newPassword);
      await modal.getByRole('button', { name: /^Submit$/i }).click();
    });
  }
}
