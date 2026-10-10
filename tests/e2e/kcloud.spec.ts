import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * KCloud (`/kcloud`) — confirmed from source: the left rail reuses Katchup's own shared
 * `Recent`/`Contact` components (already covered by `katchup*.spec.ts`/`contacts*.spec.ts`, not
 * re-tested here), so `KCloudStorage.js` is this module's entire unique surface. It has NO backend at
 * all (pure `useState`, no `Services`/`fetch`/`axios` import) — every "buy more storage" control is
 * either a dead button (no `onClick`) or a local-only modal round trip. Safe to fully drive.
 */
test.describe('KPost KCloud — storage panel', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the KCloud screen loads and shows the storage usage summary @ui', async ({ page }) => {
    const stop = watchUiHealth(page);
    await page.goto('/kcloud', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(1500);

    const health = stop();
    expect(health.pageErrors, 'no uncaught JS error on load').toEqual([]);
    await expect(
      page.getByText(/GB of .* used/i).first(),
      'the storage usage summary renders',
    ).toBeVisible({ timeout: 15_000 });
  });

  test('"Documents" switches to the app-data breakdown, whose "Clear" buttons are confirmed dead @ui', async ({
    page,
  }) => {
    await page.goto('/kcloud', { waitUntil: 'domcontentloaded', timeout: 45_000 });

    let requestFired = false;
    page.on('request', (req) => {
      const url = req.url();
      // katchupDashboardMsg is an unrelated background poll (confirmed live 2026-10-01: it fires
      // continuously on this page regardless of what's clicked) - excluding it so it can't produce a
      // false "a request fired" result for these confirmed-dead buttons.
      if (
        url.includes('/health') ||
        url.includes('.js') ||
        url.includes('.css') ||
        url.includes('katchupDashboardMsg')
      ) {
        return;
      }
      requestFired = true;
    });

    await page
      .getByText(/^Documents$/i)
      .first()
      .click();
    await expect(
      page.getByText(/Clear All Data/i).first(),
      'the app-data breakdown view renders',
    ).toBeVisible({ timeout: 10_000 });

    await page
      .getByText(/Clear All Data/i)
      .first()
      .click();
    await page
      .getByText(/Clear By Date/i)
      .first()
      .click();
    await page.waitForTimeout(1_000);

    expect(
      requestFired,
      '"Clear All Data" and "Clear By Date" are confirmed from source to have no onClick handlers',
    ).toBe(false);
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
      // katchupDashboardMsg is an unrelated background poll (confirmed live 2026-10-01) - excluding it
      // so it can't produce a false "a request fired" result for this confirmed-dead button, or for
      // the local-only "buy" flow's own no-network-call assertion below.
      if (
        url.includes('/health') ||
        url.includes('.js') ||
        url.includes('.css') ||
        url.includes('katchupDashboardMsg')
      ) {
        return;
      }
      requestFired = true;
    });

    // "Buy Monthly" is confirmed dead (no onClick) — clicking it must do nothing.
    await page
      .getByText(/Buy Monthly/i)
      .first()
      .click();
    await page.waitForTimeout(500);
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

    // Confirmed local-only "purchase" round trip — no real payment gateway, no network call.
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
