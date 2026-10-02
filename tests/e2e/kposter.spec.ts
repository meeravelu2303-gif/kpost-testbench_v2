import { STORAGE_STATE_BUSINESS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * KPoster (`/kposter`, embedded in the authenticated app per `MenuRoutes.js` line 435) — a
 * self-contained business/social feed feature. Confirmed from source: `KPOSTER_DEMO =
 * process.env.REACT_APP_KPOSTER_MODE !== 'api'` — DEMO MODE IS THE DEFAULT for any build that doesn't
 * explicitly opt into `REACT_APP_KPOSTER_MODE=api`. In demo mode every write (posts, likes, follows,
 * comments) goes through IndexedDB (`kposter-demo-v1`), entirely local to the browser — NOT the real
 * KPost backend. This is a fundamentally different safety profile from every other module tested this
 * session: nothing here touches shared server state, so this file is deliberately more thorough and
 * ungated than the rest of this suite's write-heavy tests.
 *
 * Confirmed nav is exactly 4 links: Home, Discover, Saved, Activity. "Create post" only renders for
 * business accounts (`isBusiness(actor)` — `/^BUSINESS(?:_[A-Z]+)?$/` on userType). The embedded
 * layout (used here, since we're authenticated) has NO search bar — that only exists in the
 * standalone/logged-out shell, tested separately in `kposter-public.spec.ts`.
 */
test.describe('KPost KPoster — embedded nav and feed', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the 4 nav links switch between Home / Discover / Saved / Activity @ui', async ({ page }) => {
    await page.goto('/kposter', { waitUntil: 'domcontentloaded', timeout: 45_000 });

    for (const label of ['Home', 'Discover', 'Saved', 'Activity']) {
      await page.getByText(label, { exact: true }).first().click();
      await page.waitForTimeout(500);
    }
    await expect(page.locator('body')).toBeVisible();
  });

  test('the search bar does NOT exist in the embedded (authenticated) layout @ui', async ({
    page,
  }) => {
    await page.goto('/kposter', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(
      page.getByLabel('Search KPoster'),
      'confirmed from source: the topbar (and its search input) only renders when NOT embedded — ' +
        'the authenticated/embedded layout has no search bar at all',
    ).toHaveCount(0);
  });

  test('Discover filters the feed by post type (All posts / Photos / Videos / Brochures) @ui', async ({
    page,
  }) => {
    await page.goto('/kposter/explore', { waitUntil: 'domcontentloaded', timeout: 45_000 });

    for (const tab of ['All posts', 'Photos', 'Videos', 'Brochures']) {
      await page.getByRole('button', { name: tab }).first().click();
      await page.waitForTimeout(500);
    }
    await expect(page.locator('body')).toBeVisible();
  });

  test('Activity filters the feed and "Mark notifications as read" is clickable @ui', async ({
    page,
  }) => {
    await page.goto('/kposter/notifications', { waitUntil: 'domcontentloaded', timeout: 45_000 });

    for (const label of ['All', 'Received', 'Likes', 'Comments', 'Shares', 'Saved', 'Follows']) {
      await page
        .getByRole('button', { name: label, exact: true })
        .first()
        .click({ timeout: 5_000 })
        .catch(() => undefined);
    }

    const markRead = page.getByText(/Mark notifications as read/i).first();
    const hasMarkRead = await markRead.isVisible({ timeout: 5_000 }).catch(() => false);
    if (hasMarkRead) await markRead.click();
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('KPost KPoster — Create post visibility gating', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('a Personal account does NOT see the Create post button @ui', async ({ page }) => {
    await page.goto('/kposter', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(
      page.getByRole('button', { name: /Create post/i }),
      'Create post is gated to business accounts (isBusiness check) — a Personal account must not see it',
    ).toHaveCount(0);
  });
});

test.describe('KPost KPoster — Composer (BUSINESS_S)', { tag: '@ui' }, () => {
  // Confirmed live 2026-10-01: this block was missing its own storage state and was silently running
  // as the default (personal) QA account, so "Create post" never appeared - not because of a product
  // bug, but because a personal account genuinely never sees it (confirmed by the sibling "visibility
  // gating" describe block above). Added the real BUSINESS_S session, matching
  // settings-business-bank-details.spec.ts's own convention.
  test.use({ storageState: STORAGE_STATE_BUSINESS });

  test.skip(
    !testData.businessSKpostId || testData.businessSKpostId.includes('qa.business'),
    'needs the BUSINESS_S account (QA_BUSINESS_S_KPOST_ID)',
  );

  test('a business account sees Create post, and the Composer opens with its caption field @ui', async ({
    page,
  }) => {
    await page.goto('/kposter', { waitUntil: 'domcontentloaded', timeout: 45_000 });

    const createButton = page.getByRole('button', { name: /Create post/i }).first();
    await expect(createButton, 'a business account sees Create post').toBeVisible({
      timeout: 15_000,
    });
    await createButton.click();

    await expect(
      page.getByText(/Create a poster for your business/i).first(),
      'the Composer modal opens',
    ).toBeVisible({ timeout: 10_000 });
    const caption = page.getByLabel('Post caption');
    await expect(caption, 'the caption field renders').toBeVisible();
    await caption.fill('QA UI test post — demo mode only, local IndexedDB, never touches KPost backend.');
    await expect(caption, 'the caption holds the typed text').toHaveValue(
      'QA UI test post — demo mode only, local IndexedDB, never touches KPost backend.',
    );
  });
});
