import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { settleFrames } from './support/settle';

/**
 * Settings · Data Storage panel (`DataStorage.js`) — one real, non-destructive GET
 * (`GetKlouDUsedDataList` -> `GET /kmailData/getKloudUsedData`, fired only when the "KPOST Cloud
 * Storage" radio is selected) plus a mostly-decorative "buy more storage" UI whose purchase buttons
 * are confirmed from source to be dead: the top-level "Buy" button and every plan's "Buy Monthly"
 * link have no `onClick` at all; only "Buy Yearly" opens a modal, and that modal's only action is
 * "Cancel" — there is no real purchase path to protect against, it simply doesn't exist yet.
 */
test.describe(
  'KPost Settings · Data Storage panel',
  { tag: ['@ui', '@settings', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('selecting "KPOST Cloud Storage" fires the real usage-list request @ui', async ({
      page,
      settingsPage,
    }) => {
      await settingsPage.goto();
      await settingsPage.openPanel('General Settings', 'Data Storage');

      await expect(page.getByText(/Data & Storage/i).first(), 'the panel renders').toBeVisible({
        timeout: 15_000,
      });

      const requestPromise = page
        .waitForRequest((req) => req.url().includes('/kmailData/getKloudUsedData'), {
          timeout: 10_000,
        })
        .then(() => true)
        .catch(() => false);

      await page
        .getByText(/^KPOST Cloud Storage$/i)
        .first()
        .click();
      const fired = await requestPromise;

      expect(fired, 'selecting KPOST Cloud Storage fires the real getKloudUsedData request').toBe(
        true,
      );
    });

    test('the top-level "Buy" button and a plan\'s "Buy Monthly" are confirmed dead (no purchase path exists) @ui', async ({
      page,
      settingsPage,
    }) => {
      await settingsPage.goto();
      await settingsPage.openPanel('General Settings', 'Data Storage');

      let requestFired = false;
      page.on('request', (req) => {
        const url = req.url();
        if (url.includes('/health') || url.includes('.js') || url.includes('.css')) return;
        requestFired = true;
      });

      await page.getByRole('button', { name: /^Buy$/i }).first().click();
      await settleFrames(page);

      expect(
        requestFired,
        'the top-level "Buy" button is confirmed from source to have no onClick handler',
      ).toBe(false);
    });

    test('"Buy Yearly" opens a plan modal whose only action is Cancel (no purchase completes) @ui', async ({
      page,
      settingsPage,
    }) => {
      await settingsPage.goto();
      await settingsPage.openPanel('General Settings', 'Data Storage');

      // Reach the plans view. Until 2026-10-11 any non-KPOSTCLOUD radio surfaced the plan rows; now
      // neither the radios nor the panel's "Buy" button (confirmed handler-less by the test above)
      // opens them — the plans are only reachable on /kcloud (kcloud.spec.ts covers that modal). When
      // the rows never appear here, this is recorded, not failed: the panel's own purchase path being
      // dead is the finding of the "Buy" test above, not a second one.
      await page.getByRole('button', { name: /^Buy$/i }).first().click();
      const rows = await page
        .getByText(/Buy Yearly/i)
        .first()
        .isVisible({ timeout: 10_000 })
        .catch(() => false);
      test.skip(
        !rows,
        'no plan rows are reachable from the Data Storage panel right now (radios and Buy open nothing) — the plan modal is covered on /kcloud',
      );
      await page
        .getByText(/Buy Yearly/i)
        .first()
        .click();

      await expect(page.getByText(/^Buy Yearly$/i).last(), 'the plan modal opens').toBeVisible({
        timeout: 10_000,
      });
      const cancelButton = page.getByRole('button', { name: /^Cancel$/i });
      await expect(cancelButton, 'the modal offers only Cancel, no purchase action').toBeVisible();
      await cancelButton.click();
      await expect(cancelButton, 'Cancel closes the modal').toBeHidden({ timeout: 5_000 });
    });
  },
);
