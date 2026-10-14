import { STORAGE_STATE_2 } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Browser, Page } from '@playwright/test';
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

    interface UnreadEntry {
      sender?: string;
      senderName?: string;
      count?: number;
    }

    const isUnreadCount = (url: string): boolean =>
      url.includes('/katchup/getUnopenedMessagesCount');

    /** The per-sender entry in a getUnopenedMessagesCount response body. */
    function entryFor(body: unknown, sender: string): UnreadEntry | undefined {
      const list = (body as { resultList?: UnreadEntry[] } | undefined)?.resultList ?? [];
      return list.find((e) => (e.sender ?? '').toLowerCase() === sender.toLowerCase());
    }

    /**
     * The unread badge on the Unopened-Messages strip item for `senderName` (0 when the item or badge
     * is gone). Live-confirmed 2026-10-14: a strip item is a ContactCircle with no id — its avatar is a
     * token-fetched blob: URL (AuthenticatedAvatar), so the only stable per-sender handle is the
     * `.UserName` text, whose parent holds the `.Msg-Count-Font` badge. The same name can also appear
     * in Frequently Accessed (which never carries a count), so the highest count among the matches is
     * the strip's.
     */
    async function badgeCount(page: Page, senderName: string): Promise<number> {
      const names = page.locator('.UserName', { hasText: senderName });
      const total = await names.count();
      let best = 0;
      for (let i = 0; i < total; i++) {
        const badge = names.nth(i).locator('xpath=..').locator('.Msg-Count-Font');
        if ((await badge.count()) === 0) continue;
        const text = await badge
          .first()
          .innerText()
          .catch(() => '');
        const n = parseInt(text.replace(/[^\d]/g, ''), 10);
        if (!Number.isNaN(n)) best = Math.max(best, n);
      }
      return best;
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
      const victim = testData.victimKpostId;
      const sender = await openSender(browser);

      // Track what the SERVER tells this page about account 2's unread, so a failure can say plainly
      // whether the API or the UI is wrong. `postReadServer` only records responses after the read.
      let senderName: string | undefined;
      let readAt = Number.POSITIVE_INFINITY;
      let postReadServer: number | undefined;
      page.on('response', async (r) => {
        if (!isUnreadCount(r.url()) || !r.ok()) return;
        const body: unknown = await r.json().catch(() => undefined);
        const entry = entryFor(body, victim);
        if (entry?.senderName) senderName = entry.senderName;
        if (Date.now() >= readAt) postReadServer = entry?.count ?? 0;
      });

      try {
        // Account 2 sends a fresh message to account 1 (so account 1 has a new unread from account 2).
        await openConversation(sender, testData.kpostId);
        await sender.locator('.msg-arrow').first().click();
        await sendMessage(sender, subject, 'QA badge-refresh probe — safe to ignore');

        // Account 1 opens Katchup; the page's own unread-count fetch names account 2 and its count.
        const firstLoad = page.waitForResponse((r) => isUnreadCount(r.url()) && r.ok(), {
          timeout: 30_000,
        });
        await gotoKatchup(page);
        await firstLoad;
        await parkPointerAwayFromSideMenu(page);
        await settleFrames(page).catch(() => undefined);
        expect(
          senderName,
          "the server's unread list for account 1 includes account 2 (the fresh unread)",
        ).toBeTruthy();
        const name = senderName!;
        const before = await badgeCount(page, name);
        expect(before, "a fresh unread message raises account 2's unread badge").toBeGreaterThan(0);

        // Read it: open the conversation (this stays on the Katchup list — the badge is still on screen).
        readAt = Date.now();
        await page.locator(`[id="${victim}"], [id^="${victim}-"]`).first().click();

        // Give the read and the client's socket-driven re-fetch up to 10s — but NO reload.
        let after = before;
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          after = await badgeCount(page, name);
          if (after < before) break;
          await page.waitForTimeout(500);
        }

        const server =
          postReadServer === undefined
            ? 'no re-fetch of the count was observed after the read'
            : `the server reported ${postReadServer} after the read`;
        test.info().annotations.push({
          type: 'observed',
          description: `${name} unread badge: before read=${before}, after read=${after}; ${server}`,
        });
        // Correct behaviour: the badge drops (to 0 / below its pre-read value) in place. A badge that
        // stays at its old number after the message is read is the reported "stuck at 4/5" bug — and
        // when the server already says 0, that pins the fault on the UI, not the API.
        expect(
          after,
          `the unread badge must drop after the conversation is read (was ${before}, still ${after}; ` +
            `${server}) — a badge that never updates in place is the stale-count bug`,
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
