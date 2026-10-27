import { expect, type Page, test } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * The two-step login screen (`Login.js`): step 1 enters the KPOST ID or mobile, step 2 the
 * password. The component has no `data-testid` hooks, so locators use role, label or text.
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

  /** Waits for the id field to enable (once countries load), reloading once if throttled. */
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

      // The domain autocomplete overlays Submit, so dismiss it with Escape and submit with Enter.
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

  // Forgot-password flow. Clicking "Forgot Password ?" sends a REAL OTP at once, so run it only on
  // the OTP test gateway and only against the spare `QA_FORGOT_PASSWORD_KPOST_ID` account.

  /** The Forgot-Password modal's OTP-entry section: `#input_0`..`#input_5`, same as every other. */
  readonly forgotPasswordOtpFirstBox = this.page.locator('#input_0');
  /** The forgot-password modal; its password fields have no placeholder, so use type and order. */
  private readonly forgotPasswordModal = this.page.locator('.modal, [role="dialog"]').filter({
    has: this.page.getByText(/^Forgot Password$/i),
  });

  /** Goes to the password step and clicks "Forgot Password ?", which sends a real OTP. */
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
        // No "Invalid OTP" text here: still on the OTP screen after a real wait means invalid.
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
   * Fills New and Confirm New Password, found by `input[type="password"]` order inside the modal.
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
