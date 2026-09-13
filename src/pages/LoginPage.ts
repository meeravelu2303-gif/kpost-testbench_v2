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
 * more brittle than an id, and the reason `docs/LIVE-ENDPOINTS.md` flags test-ids as a UI-bench
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
}
