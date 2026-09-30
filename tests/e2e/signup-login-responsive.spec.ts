import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * Responsive matrix for Signup/Login at the widths `signup-business.spec.ts`'s existing mobile check
 * (480px only) never covered: TABLET (768px) and LANDSCAPE mobile. Unlike the authenticated app shell
 * (desktop-only by design — see `@ui/ui-checks`'s `ui.layout` comment), Signup/Login are public-facing
 * pages with their own dedicated sub-992px implementation (`MainSignup.css`'s breakpoint), so testing
 * the WHOLE sub-992px range here — not just one phone width — is testing something the product
 * actually claims to support, not a size it never targets.
 *
 * Each case asserts no uncaught JS crash and that the key control for that step is actually usable
 * (visible, not clipped/unreachable) at that viewport — the same bar #825 (Business mobile) was
 * originally found against, just at two more points in the same range.
 */
test.describe('KPost signup/login · responsive matrix (tablet + landscape)', { tag: '@ui' }, () => {
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
    await loginPage.passwordInput.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined);

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
    await loginPage.passwordInput.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined);

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
});
