import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * Signup/Login at tablet (768px) and landscape-mobile widths: no JS crash, and each step's key control
 * is usable. These public pages support the whole sub-992px range, unlike the desktop-only app shell.
 */
test.describe(
  'KPost signup/login · responsive matrix (tablet + landscape)',
  { tag: ['@ui', '@auth', '@signup', '@regression'] },
  () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('Login reaches the password step at tablet width (768×1024) @ui', async ({
      page,
      loginPage,
    }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      const stop = watchUiHealth(page);

      await page.goto(loginPage.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await loginPage.expectLoaded();
      await loginPage.enterLoginId(testData.kpostId);
      await loginPage.passwordInput
        .waitFor({ state: 'visible', timeout: 20_000 })
        .catch(() => undefined);

      const health = stop();
      expect(health.pageErrors, 'no uncaught JS error at 768×1024').toEqual([]);
      await expect(
        loginPage.passwordInput,
        'the password field is visible and usable at tablet width',
      ).toBeVisible();
    });

    test('Login reaches the password step at mobile landscape (667×375) @ui', async ({
      page,
      loginPage,
    }) => {
      await page.setViewportSize({ width: 667, height: 375 });
      const stop = watchUiHealth(page);

      await page.goto(loginPage.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await loginPage.expectLoaded();
      await loginPage.enterLoginId(testData.kpostId);
      await loginPage.passwordInput
        .waitFor({ state: 'visible', timeout: 20_000 })
        .catch(() => undefined);

      const health = stop();
      expect(health.pageErrors, 'no uncaught JS error at 667×375 landscape').toEqual([]);
      await expect(
        loginPage.passwordInput,
        'the password field is visible and usable at mobile landscape',
      ).toBeVisible();
    });

    test('Signup account-type picker renders correctly at tablet width (768×1024) @ui', async ({
      page,
      signupPage,
    }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      const stop = watchUiHealth(page);

      await page.goto(signupPage.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await signupPage.expectLoaded();

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      const health = stop();
      expect(health.pageErrors, 'no uncaught JS error at 768×1024').toEqual([]);
      expect(
        overflow.scrollWidth,
        `no horizontal overflow at 768px tablet width (content ${overflow.scrollWidth}px vs viewport ${overflow.clientWidth}px)`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 16);
    });

    test('Signup Business category picker renders correctly at tablet width (768×1024) @ui', async ({
      page,
      signupPage,
    }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      const stop = watchUiHealth(page);

      await page.goto(signupPage.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await signupPage.expectLoaded();
      await signupPage.chooseAccountType('Business');
      await page
        .locator('.category-contentBox-layout')
        .filter({ visible: true })
        .first()
        .waitFor({ state: 'visible', timeout: 20_000 });

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      const health = stop();
      expect(health.pageErrors, 'no uncaught JS error at 768×1024').toEqual([]);
      expect(
        overflow.scrollWidth,
        `no horizontal overflow at 768px tablet width (content ${overflow.scrollWidth}px vs viewport ${overflow.clientWidth}px)`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 16);
    });
  },
);
