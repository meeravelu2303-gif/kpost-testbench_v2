import { expect, test } from '@fixtures';

test.describe('Home page', { tag: '@smoke' }, () => {
  test('loads with the hero heading', async ({ homePage, page }) => {
    await homePage.goto();

    await expect(page).toHaveTitle(/Playwright/);
    await expect(homePage.getStartedLink).toBeVisible();
  });

  test('"Get started" opens the installation docs', async ({ homePage, page }) => {
    await homePage.goto();
    await homePage.openGetStarted();

    await expect(page).toHaveURL(/\/docs\/intro/);
    await expect(page.getByRole('heading', { name: 'Installation', level: 1 })).toBeVisible();
  });
});
