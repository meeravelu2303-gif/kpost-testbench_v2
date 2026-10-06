import { env } from '@config/env';
import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * Screens/tabs confirmed dead from source (2026-10-05 ground-truth audit,
 * `project_kpost_admin_frontend_ground_truth_2026_10_05`) — pinned here so a future accidental
 * implementation (or regression) doesn't go unnoticed either way. Each assertion matches what the
 * source says TODAY; if one of these ever starts doing something real, this test should start
 * failing, which is the signal to update it rather than silently keep skipping it.
 */
test.describe('Admin/HR-Setup — confirmed-dead screens stay harmlessly dead', { tag: '@admin-ui' }, () => {
  test.skip(
    process.env.ADMIN_UI_LIFECYCLE !== 'true' ||
      !env.ADMIN_UI_BASE_URL ||
      testData.businessMKpostId.includes('qa.business'),
    'needs ADMIN_UI_LIFECYCLE=true, a configured admin host and BUSINESS_M account',
  );

  test('Dashboard renders only its static title, no API calls @ui', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/adminTierAttribute') || req.url().includes('/employeeDetails')) {
        requests.push(req.url());
      }
    });
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.getByText('Dashboard', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_500);
    expect(requests, 'Dashboard must not fire any Admin-API calls — confirmed static').toEqual([]);
  });

  test('Employee Data › "Add From Application" tab never calls the backend on submit @ui', async ({
    page,
  }) => {
    await page.goto('/employee-data', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(1_000);
    const tab = page.locator('.nav-pills .nav-link', { hasText: 'Add From Application' }).first();
    const tabVisible = await tab.isVisible({ timeout: 10_000 }).catch(() => false);
    // Confirmed live 2026-10-05: EmployeeData.js gates its entire Add/Edit area (including this tab)
    // behind `role === 1/2/3` (EmployeeData.js:158-219) — BUSINESS_M's current role value shows none
    // of the three branches, so no tabs render at all. The role system itself wasn't mapped by the
    // 2026-10-05 frontend audit; needs a account with the right role value to actually reach this.
    test.skip(!tabVisible, '"Add From Application" tab not reachable with this account\'s role value');
    if (!tabVisible) return;
    await tab.click();

    let wrote = false;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/employeeDetails')) wrote = true;
    });
    const submit = page.getByRole('button', { name: /submit/i }).first();
    const submitVisible = await submit.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!submitVisible, 'Submit button not reachable on this tab');
    if (!submitVisible) return;
    await submit.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(1_000);

    expect(
      wrote,
      '"Add From Application" is confirmed from source to only console.log on submit — it must not ' +
        'fire a real save call',
    ).toBe(false);
  });

  test('Employee Management › "History" tab renders nothing but its own name @ui', async ({ page }) => {
    await page.goto('/employee-management', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.locator('.nav-pills .nav-link', { hasText: 'History' }).first().click();
    await page.waitForTimeout(500);

    const stop = watchUiHealth(page);
    await page.waitForTimeout(1_000);
    const health = stop();

    expect(health.pageErrors, 'the dead History tab must not throw a JS error when opened').toEqual(
      [],
    );
    await expect(
      page.getByText('History', { exact: true }).first(),
      'the History tab is confirmed from source to render only its own literal name, nothing else',
    ).toBeVisible();
  });

  test('"Menu Privilege" sidebar link has no route — clicking it must not crash the app @ui', async ({
    page,
  }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // "Menu Privilege" is nested under the "Admin Setup" CNavGroup — expand it first.
    await page.getByText('Admin Setup', { exact: true }).first().click();
    await page.waitForTimeout(500);
    const link = page.getByText('Menu Privilege', { exact: true }).first();
    const linkVisible = await link.isVisible({ timeout: 10_000 }).catch(() => false);
    test.skip(!linkVisible, '"Menu Privilege" nav link not reachable this run');
    if (!linkVisible) return;

    const stop = watchUiHealth(page);
    await link.click();
    await page.waitForTimeout(1_000);
    const health = stop();

    expect(
      health.pageErrors,
      '"Menu Privilege" has no route/component at all (confirmed from source) — clicking it must ' +
        'render blank, not crash the app with a JS error',
    ).toEqual([]);
  });

  test('"Postal Code Library" sidebar link has no route — clicking it must not crash the app @ui', async ({
    page,
  }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // "Postal Code Library" is nested under the "Admin Setup" CNavGroup — expand it first.
    await page.getByText('Admin Setup', { exact: true }).first().click();
    await page.waitForTimeout(500);
    const link = page.getByText('Postal Code Library', { exact: true }).first();
    const linkVisible = await link.isVisible({ timeout: 10_000 }).catch(() => false);
    test.skip(!linkVisible, '"Postal Code Library" nav link not reachable this run');
    if (!linkVisible) return;

    const stop = watchUiHealth(page);
    await link.click();
    await page.waitForTimeout(1_000);
    const health = stop();

    expect(
      health.pageErrors,
      '"Postal Code Library" has no route/component at all (confirmed from source) — clicking it ' +
        'must render blank, not crash the app with a JS error',
    ).toEqual([]);
  });
});
