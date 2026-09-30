import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * KOS · KAD Document (`KADDocument.js`) — real backend (`GetAllKWordDocs` -> `GET
 * /v2/kword/documentsType`, `GetKADCounts`), and a real, destructive share action
 * (`ShareKADDocument` -> `POST /v2/kword/share`, reusing `RoleAssignmentModal`). Scoped to the
 * read-only listing/search surface; the share flow is not driven to completion here (it would grant
 * real document access to another account with no simple self-clean available for this pass).
 */
test.describe('KPost KOS · KAD Document panel', { tag: '@ui' }, () => {
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
});
