import { STORAGE_STATE_2 } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Browser, Locator, Page } from '@playwright/test';
import {
  deleteSentMessage,
  gotoKatchup,
  openConversation,
  parkPointerAwayFromSideMenu,
  sendMessage,
} from './support/katchup';
import { settleFrames } from './support/settle';

/**
 * Unread BADGE refreshes after a conversation is read (the UI half of FR-K07).
 *
 * Why: a QA complaint that the Katchup unread count "shows 4 or 5 even after the message is read". The
 * API side is already proven correct — `unread-count-clears-on-read.spec.ts` shows the server drops the
 * per-sender unread to 0 the moment the conversation is opened. This test covers the OTHER half: whether
 * the on-screen badge actually reflects that, or stays stuck at a stale number.
 *
 * Faithful repro of the user's flow: opening a conversation does NOT navigate away from the Katchup
 * list — the list (and its unread badges) stays on the left while the thread opens on the right — so a
 * correct UI must clear the badge IN PLACE (the client re-fetches the count on the `senderMsgCount`
 * socket event). This test never reloads the page after reading; a reload would re-fetch and mask the
 * staleness, which is exactly the bug.
 *
 * Account 2 (STORAGE_STATE_2) sends to account 1 (the default `page`, the viewer we measure). Gated
 * KATCHUP_UI_LIFECYCLE + both QA accounts, like every write flow. Self-cleans the probe message.
 *
 * NOTE (needs one live selector-tuning pass): the unread badge is `.Msg-Count` / `.Msg-Count-Font`
 * (ContactCircle, from the Unopened-Messages strip). `badgeCountFor` tries to scope it to account 2's
 * row/circle and falls back to the page-wide badge; confirm the scoping on the first live run.
 */
test.describe(
  'KPost Katchup · unread badge refreshes after read (FR-K07, UI)',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
    test.skip(
      process.env.KATCHUP_UI_LIFECYCLE !== 'true',
      'sends a real message between two accounts; set KATCHUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId ||
        testData.kpostId.includes('qa.bench') ||
        !testData.victimKpostId ||
        testData.victimKpostId.includes('qa.bench'),
      'needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID)',
    );

    /** The live unread badge count attributed to `kpostId` on the Katchup list, or 0 if none shows. */
    async function badgeCountFor(page: Page, kpostId: string): Promise<number> {
      // Prefer the badge inside the strip item / row keyed by the sender; fall back to any badge on the
      // page (there is only our one probe sender in a clean state).
      const scoped = page
        .locator(`[id="${kpostId}"], [id^="${kpostId}-"]`)
        .locator('.Msg-Count-Font, .Msg-Count')
        .first();
      const anyBadge = page.locator('.Msg-Count-Font, .Msg-Count').first();
      const badge: Locator = (await scoped.count()) > 0 ? scoped : anyBadge;
      if ((await badge.count()) === 0) return 0;
      const text = (
        await badge
          .first()
          .innerText()
          .catch(() => '')
      ).trim();
      const n = parseInt(text.replace(/[^\d]/g, ''), 10);
      return Number.isNaN(n) ? 0 : n;
    }

    async function openSender(browser: Browser): Promise<Page> {
      const context = await browser.newContext({ storageState: STORAGE_STATE_2 });
      return context.newPage();
    }

    test('reading a conversation clears its unread badge in place, with no page reload @ui', async ({
      page,
      browser,
    }) => {
      const subject = `QA badge ${Date.now()}`;
      const sender = await openSender(browser);
      try {
        // Account 2 sends a fresh message to account 1 (so account 1 has a new unread from account 2).
        await openConversation(sender, testData.kpostId);
        await sender.locator('.msg-arrow').first().click();
        await sendMessage(sender, subject, 'QA badge-refresh probe — safe to ignore');

        // Account 1 opens Katchup: a new unread from account 2 must raise its badge.
        await gotoKatchup(page);
        await parkPointerAwayFromSideMenu(page);
        await settleFrames(page).catch(() => undefined);
        const before = await badgeCountFor(page, testData.victimKpostId);
        expect(before, "a fresh unread message raises account 2's unread badge").toBeGreaterThan(0);

        // Read it: open the conversation (this stays on the Katchup list — the badge is still on screen).
        await page
          .locator(`[id="${testData.victimKpostId}"], [id^="${testData.victimKpostId}-"]`)
          .first()
          .click();
        // Let the read register and the client re-fetch the count on its socket event — but NO reload.
        await page.waitForTimeout(3_000);
        await settleFrames(page).catch(() => undefined);

        // Correct behaviour: the badge drops (to 0 / below its pre-read value) in place. A badge that
        // stays at its old number after the message is read is the reported "stuck at 4/5" bug.
        const after = await badgeCountFor(page, testData.victimKpostId);
        test.info().annotations.push({
          type: 'observed',
          description: `account 2 unread badge: before read=${before}, after read=${after}`,
        });
        expect(
          after,
          `the unread badge must drop after the conversation is read (was ${before}, still ${after}) ` +
            '— a badge that never updates in place is the stale-count bug',
        ).toBeLessThan(before);
      } finally {
        await page.goto('/katchup', { waitUntil: 'domcontentloaded' }).catch(() => undefined);
        // Clean up the probe message from the sender's side.
        await openConversation(sender, testData.kpostId).catch(() => undefined);
        await sender
          .locator('.msg-arrow')
          .first()
          .click()
          .catch(() => undefined);
        await deleteSentMessage(sender, subject).catch(() => undefined);
        await sender.context().close();
      }
    });
  },
);
