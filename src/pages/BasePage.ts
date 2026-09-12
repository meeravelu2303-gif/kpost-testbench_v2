import type { Page } from '@playwright/test';

/**
 * Base for all page objects. Subclasses declare their route and what "loaded" means;
 * locators live on the page object, assertions about business outcomes live in tests.
 */
export abstract class BasePage {
  /** Route relative to `baseURL`, e.g. `/login`. */
  abstract readonly path: string;

  constructor(protected readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto(this.path);
    await this.expectLoaded();
  }

  /** Assert the page's key element is visible. */
  abstract expectLoaded(): Promise<void>;
}
