import { expect } from '@playwright/test';
import { BasePage } from './BasePage';

/** Example page object targeting the default BASE_URL (playwright.dev). Replace with KPost pages. */
export class HomePage extends BasePage {
  readonly path = '/';

  readonly heroHeading = this.page.getByRole('heading', { level: 1 });
  readonly getStartedLink = this.page.getByRole('link', { name: 'Get started' });

  async expectLoaded(): Promise<void> {
    await expect(this.heroHeading).toBeVisible();
  }

  async openGetStarted(): Promise<void> {
    await this.getStartedLink.click();
  }
}
