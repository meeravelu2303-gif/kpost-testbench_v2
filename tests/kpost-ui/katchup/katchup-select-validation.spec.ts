import type { Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { openConversation } from '../support/katchup';
import { toast } from '../support/validation';

/**
 * Katchup select mode (thread "More" → tick messages → the footer's Forward / Transfer / Copy / Save /
 * Delete) refuses an action with no message ticked, or more than the action takes
 * (KatchupMessage.js handleCopyButtonClick, handleTransfer, handleSaveButtonClick; ForwardFooter.js).
 * Only existing messages are ticked, and every save / delete / forward / transfer call is blocked
 * at the network, so nothing changes.
 */

const WRITES = /saveKatchup|deleteKatchUpMessage|forward|transfer|saveMessage/i;

async function openSelectMode(page: Page): Promise<void> {
  await page.route(
    (url) => WRITES.test(url.pathname),
    (route) => route.abort(),
  );
  await openConversation(page, testData.victimKpostId);
  await page.locator('.icon-KP_59-More-Lined').first().click({ timeout: 15_000 });
  await expect(
    page.getByRole('status').filter({ hasText: /Selected Messages/i }),
    'select mode is on',
  ).toBeVisible({ timeout: 15_000 });
}

/** Ticks the first `count` messages on screen. */
async function tick(page: Page, count: number): Promise<void> {
  const boxes = page.locator('.message-select-box input[type="checkbox"]');
  await expect
    .poll(() => boxes.count(), { message: `at least ${count} messages to tick`, timeout: 15_000 })
    .toBeGreaterThanOrEqual(count);
  for (let i = 0; i < count; i += 1) await boxes.nth(i).check();
}

/** Clicks a footer action and returns the text of the native alert it raised, if any. */
async function clickFooter(page: Page, icon: string): Promise<string | undefined> {
  const dialog = page
    .waitForEvent('dialog', { timeout: 5_000 })
    .then(async (d) => {
      const text = d.message();
      await d.dismiss().catch(() => undefined);
      return text;
    })
    .catch(() => undefined);
  await page.locator(icon).last().click({ timeout: 10_000 });
  return dialog;
}

test.describe(
  'KPost Katchup · select mode refuses an action with the wrong number of messages',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
    test.skip(!testData.victimKpostId, 'needs the 2nd QA account (QA_VICTIM_KPOST_ID)');

    test('Copy with nothing ticked is refused', async ({ page }) => {
      await openSelectMode(page);
      const alert = await clickFooter(page, '.icon-KP_44-Copy');
      expect(alert, 'the user is told to pick a message').toBe('Please select a message to copy.');
    });

    test('Copy with two messages ticked is refused', async ({ page }) => {
      await openSelectMode(page);
      await tick(page, 2);
      await clickFooter(page, '.icon-KP_44-Copy');
      await expect(
        toast(page, 'You can copy only one message at a time.'),
        'the user is told only one can be copied',
      ).toBeVisible({ timeout: 10_000 });
    });

    test('Transfer with nothing ticked is refused', async ({ page }) => {
      await openSelectMode(page);
      const alert = await clickFooter(page, '.icon-KP_70-Transfer');
      expect(alert, 'the user is told to pick a message').toBe(
        'Please select a message to Transfer.',
      );
    });

    test('Transfer with two messages ticked is refused, and says Transfer', async ({ page }) => {
      await openSelectMode(page);
      await tick(page, 2);
      await clickFooter(page, '.icon-KP_70-Transfer');
      // The screen's own wording for this rule elsewhere is "You can Transfer only one message at
      // a time."; the footer shows the Copy message instead.
      await expect(
        toast(page, /only one message at a time/i),
        'two messages cannot be transferred at once',
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        toast(page, 'You can Transfer only one message at a time.'),
        'and the message names the action the user took (Transfer, not copy)',
      ).toBeVisible({ timeout: 2_000 });
    });

    test('Save with nothing ticked is refused', async ({ page }) => {
      await openSelectMode(page);
      await clickFooter(page, '.icon-KP_71-Save');
      await expect(
        toast(page, 'Select at least one checkbox to save messages.'),
        'the user is told to tick a message',
      ).toBeVisible({ timeout: 10_000 });
    });

    test('Delete with nothing ticked is refused', async ({ page }) => {
      await openSelectMode(page);
      await clickFooter(page, '.icon-KP_29-Delete');
      // Delete asks for confirmation first; confirming with nothing ticked must still be refused.
      await page
        .getByRole('button', { name: /^(Confirm|Delete|Yes)$/i })
        .last()
        .click({ timeout: 5_000 })
        .catch(() => undefined);
      await expect(
        toast(page, 'Select at least one checkbox to delete messages.'),
        'the user is told to tick a message',
      ).toBeVisible({ timeout: 10_000 });
    });

    test('Forward with Thread with nothing ticked is refused', async ({ page }) => {
      await openSelectMode(page);
      await clickFooter(page, 'div.icon-KP_230_Forward-with-Thread');
      await expect(
        toast(page, 'Please select atleast one message'),
        'the user is told to tick a message',
      ).toBeVisible({ timeout: 10_000 });
    });

    test('Forward with Thread with two messages ticked is refused', async ({ page }) => {
      await openSelectMode(page);
      await tick(page, 2);
      await clickFooter(page, 'div.icon-KP_230_Forward-with-Thread');
      await expect(
        toast(page, 'Please select only one message to forward'),
        'a thread forward takes one message',
      ).toBeVisible({ timeout: 10_000 });
    });

    test('Forward with more than five messages ticked is refused', async ({ page }) => {
      await openSelectMode(page);
      // Select All ticks every loaded message; the counter reads "Selected Messages: N / 5".
      await page.locator('input.selectAllCheck').first().check();
      const counter = page.getByRole('status').filter({ hasText: /Selected Messages/i });
      const selected = Number(
        /(\d+)\s*\/\s*5/.exec((await counter.innerText().catch(() => '')) ?? '')?.[1] ?? 0,
      );
      test.skip(
        selected <= 5,
        'needs provisioned conversation with more than five loaded messages',
      );
      await clickFooter(page, '.icon-KP_119-Forward');
      await expect(
        toast(page, 'Only up to 5 messages can be forwarded at a time'),
        'the user is told the limit',
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        page.getByRole('dialog').filter({ hasText: 'Forward To' }),
        'and no recipient picker opens',
      ).toBeHidden({ timeout: 3_000 });
    });

    test('Forward with nothing ticked opens no recipient picker', async ({ page }) => {
      await openSelectMode(page);
      await clickFooter(page, '.icon-KP_119-Forward');
      await expect(
        page.getByRole('dialog').filter({ hasText: 'Forward To' }),
        'nothing to forward: the recipient picker does not open',
      ).toBeHidden({ timeout: 5_000 });
    });
  },
);
