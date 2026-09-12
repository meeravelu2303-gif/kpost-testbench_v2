import { expect, test } from '@playwright/test';
import { BasePage } from './BasePage';

/** Template login page — adjust the route and locators to match the KPost login screen. */
export class LoginPage extends BasePage {
  readonly path = '/login';

  readonly usernameInput = this.page.getByLabel(/email|username/i);
  readonly passwordInput = this.page.getByLabel(/password/i);
  readonly submitButton = this.page.getByRole('button', { name: /sign in|log in/i });
  readonly errorMessage = this.page.getByRole('alert');

  async expectLoaded(): Promise<void> {
    await expect(this.submitButton).toBeVisible();
  }

  async login(username: string, password: string): Promise<void> {
    await test.step(
      `Log in as ${username}`,
      async () => {
        await this.usernameInput.fill(username);
        await this.passwordInput.fill(password);
        await this.submitButton.click();
      },
      { box: true },
    );
  }
}
