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

  // Step 2 — the password field (type=password) and the Login button.
  readonly passwordInput = this.page.locator('input[type="password"]');
  readonly loginButton = this.page.getByRole('button', { name: /^Login$/i });
  // Inline validation message under the password field (`.login__error-msg`).
  readonly inlineError = this.page.locator('.login__error-msg');

  constructor(page: Page) {
    super(page);
  }

  async expectLoaded(): Promise<void> {
    await expect(this.loginIdInput).toBeVisible();
  }

  /** Step 1 only: enter an id and submit, without a password. */
  async enterLoginId(loginId: string): Promise<void> {
    await test.step(`Enter KPOST ID ${loginId}`, async () => {
      await this.loginIdInput.fill(loginId);
      await this.submitButton.click();
    });
  }

  /** The whole flow: id -> Submit -> password -> Login. */
  async login(loginId: string, password: string): Promise<void> {
    await test.step(
      `Log in as ${loginId}`,
      async () => {
        await this.enterLoginId(loginId);
        await this.passwordInput.waitFor({ state: 'visible' });
        await this.passwordInput.fill(password);
        await this.loginButton.click();
      },
      { box: true },
    );
  }
}
