import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * KOS KAD Document: read-only listing and search. Share is not driven: it grants real document access
 * with no clean-up path.
 */
test.describe(
  'KPost KOS · KAD Document panel',
  {
    tag: ['@ui', '@kos', '@verticals', '@quarantine'],
    annotation: [{ type: 'quarantine', description: 'out of scope: not a supported feature' }],
  },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('the KAD Document panel loads its document list and search box @ui', async ({ page }) => {
      await page.goto('/kdoc', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.getByText('KAD Document', { exact: true }).first().click();

      await expect(
        page.getByPlaceholder(/Search your documents/i).first(),
        'the KAD Document search box renders',
      ).toBeVisible({ timeout: 15_000 });
    });
  },
);
