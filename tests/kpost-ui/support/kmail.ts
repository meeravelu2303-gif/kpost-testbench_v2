import type { Locator, Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { setupStep } from '@ui/setup-step';
import { waitLoaded } from '../journeys/support/journey';

interface ThreadMail {
  kmailID?: number;
  kmailType?: number;
  attachmentFlag?: number;
  kmailTransactionList?: Array<{
    sender?: string;
    receiver?: string;
    groupFlag?: boolean;
    deleteByReceiver?: string;
  }>;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Opens the KMail conversation with the 2nd QA account (Recents search by its name) and expands a
 * mail RECEIVED from it (the one that carries the ReplyIcon menu). Returns that mail's expanded box.
 */
export async function openReceivedMail(page: Page): Promise<Locator> {
  const thread: ThreadMail[] = [];
  page.on('response', (response) => {
    if (!response.url().includes('/common/selectedContactMails')) return;
    void response
      .json()
      .then((body: { data?: unknown }) => {
        if (Array.isArray(body?.data)) thread.push(...(body.data as ThreadMail[]));
      })
      .catch(() => undefined);
  });
  await page.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await waitLoaded(page);

  const local = testData.victimKpostId.split('@')[0] ?? testData.victimKpostId;
  await page.locator('.Serach_input').first().fill(local);
  // The name is lower case in the page ("qatest2 bench") and capitalised by CSS. The Recents list
  // is the scrollable region; the "Unopened Mails" strip above it carries the same name.
  const row = page
    .getByRole('region', { name: 'Scrollable content region' })
    .getByText(new RegExp(`^${escapeRegExp(local)}\\b`, 'i'))
    .filter({ visible: true })
    .first();
  const listed = await row
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(
    !listed,
    'needs provisioned KMail conversation with the 2nd QA account (QA_VICTIM_KPOST_ID)',
  );
  await row.click();
  await expect
    .poll(() => thread.length, {
      message: setupStep('the conversation with the 2nd QA account loads'),
      timeout: 30_000,
    })
    .toBeGreaterThan(0);

  const me = testData.kpostId.toLowerCase();
  const them = testData.victimKpostId.toLowerCase();
  const received = thread.filter((m) => {
    const tx = m.kmailTransactionList ?? [];
    return (
      Boolean(m.kmailID) &&
      !tx[0]?.groupFlag &&
      tx[0]?.sender?.toLowerCase() === them &&
      tx.some((t) => t.receiver?.toLowerCase() === me && t.deleteByReceiver !== 'Y')
    );
  });
  const mail = received.find((m) => m.kmailType === 0 && m.attachmentFlag === 0) ?? received[0];
  test.skip(!mail, 'needs provisioned mail received from the 2nd QA account (QA_VICTIM_KPOST_ID)');

  // Expanded mails render as div.cursor#<kmailID>; a collapsed one opens from its text column.
  const box = page.locator(`div.cursor[id="${mail!.kmailID}"]`);
  if (!(await box.isVisible({ timeout: 5_000 }).catch(() => false))) {
    const card = page.locator(`.kmailMailCard[id="${mail!.kmailID}"]`);
    await card.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => undefined);
    await card.locator('.kmailSceenwidthyiou').first().click({ timeout: 10_000 });
  }
  await expect(box, setupStep('the received mail opens')).toBeVisible({ timeout: 20_000 });
  return box;
}
