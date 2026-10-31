import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * KCloud (/kcloud) storage screen. It has no backend: every control is either handler-less or a
 * local-only modal round trip, so it is safe to drive fully.
 */
test.describe('KPost KCloud — storage panel', { tag: ['@ui', '@verticals', '@regression'] }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the KCloud screen loads and shows the storage usage summary @ui', async ({ page }) => {
    const stop = watchUiHealth(page);
    await page.goto('/kcloud', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(
      page.getByText(/GB of .* used/i).first(),
      'the storage usage summary renders',
    ).toBeVisible({ timeout: 15_000 });

    const health = stop();
    expect(health.pageErrors, 'no uncaught JS error on load').toEqual([]);
  });

  test('"Documents" switches to the app-data breakdown, whose "Clear" buttons are confirmed dead @ui', async ({
    page,
  }) => {
    await page.goto('/kcloud', { waitUntil: 'domcontentloaded', timeout: 45_000 });

    await page
      .getByText(/^Documents$/i)
      .first()
      .click();
    await expect(
      page.getByText(/Clear All Data/i).first(),
      'the app-data breakdown view renders',
    ).toBeVisible({ timeout: 10_000 });

    // Listen only from here so the screen's own loads don't count; background polls are excluded.
    const fired: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (req.method() === 'GET' || /health|katchupDashboardMsg/.test(url)) return;
      fired.push(`${req.method()} ${url.replace(/^https?:\/\/[^/]+/, '')}`);
    });
    await page
      .getByText(/Clear All Data/i)
      .first()
      .click();
    await page
      .getByText(/Clear By Date/i)
      .first()
      .click();
    // Both buttons are handler-less; give a request one second to appear, no longer.
    await page
      .waitForRequest((r) => r.method() !== 'GET' && !/health|katchupDashboardMsg/.test(r.url()), {
        timeout: 1_000,
      })
      .catch(() => undefined);

    expect(
      fired,
      '"Clear All Data" and "Clear By Date" are confirmed from source to have no onClick handlers — no write must follow the clicks',
    ).toEqual([]);
  });

  test('"Buy" opens the storage-plans view, and "Buy Yearly" opens a purchase modal ending in a real "Payment SuccessFul" screen @ui', async ({
    page,
  }) => {
    await page.goto('/kcloud', { waitUntil: 'domcontentloaded', timeout: 45_000 });

    await page.getByRole('button', { name: /^Buy$/i }).first().click();
    await expect(page.getByText(/Buy Yearly/i).first(), 'the plans view renders').toBeVisible({
      timeout: 10_000,
    });

    let requestFired = false;
    page.on('request', (req) => {
      const url = req.url();
      // Only a write counts as the button firing; background GETs do not.
      if (
        req.method() === 'GET' ||
        url.includes('/health') ||
        url.includes('katchupDashboardMsg')
      ) {
        return;
      }
      requestFired = true;
    });

    // "Buy Monthly" has no onClick: clicking it must do nothing.
    await page
      .getByText(/Buy Monthly/i)
      .first()
      .click();
    await page
      .waitForRequest((r) => !/health|\.js|\.css|katchupDashboardMsg/.test(r.url()), {
        timeout: 1_000,
      })
      .catch(() => undefined);
    expect(requestFired, '"Buy Monthly" is confirmed from source to have no onClick handler').toBe(
      false,
    );

    await page
      .getByText(/Buy Yearly/i)
      .first()
      .click();
    await expect(page.getByText(/^Buy Yearly$/i).last(), 'the plan modal opens').toBeVisible({
      timeout: 10_000,
    });

    // A local-only "purchase": no payment gateway, no network call.
    await page.getByAltText('wallet').first().click();
    await expect(
      page.getByText(/Payment SuccessFul/i).first(),
      'clicking the wallet image always shows a local "Payment SuccessFul" state, with no real ' +
        'payment processed (no Services import anywhere in this component)',
    ).toBeVisible({ timeout: 10_000 });

    expect(
      requestFired,
      'the entire "buy" flow is confirmed from source to be local-only — no network request at any step',
    ).toBe(false);

    await page
      .getByRole('button', { name: /^Done$/i })
      .first()
      .click();
  });
});
