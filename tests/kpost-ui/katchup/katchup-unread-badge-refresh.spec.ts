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
} from '../support/katchup';
import { settleFrames } from '../support/settle';
import { signedIn } from '@fixtures/login-gate';

/**
 * Katchup unread badges (per-sender strip and side-menu total) drop in place after a conversation is
 * read, with no reload (a reload would mask a stale count). Account 2 sends to account 1; gated behind
 * KATCHUP_UI_LIFECYCLE, self-cleaning.
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
     * The unread badge on the Unopened-Messages strip for `senderName` (0 when gone). Strip items have
     * no id, so the `.UserName` text is the handle; the same name in Frequently Accessed has no count,
     * so the highest match wins.
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
      const context = await browser.newContext({ storageState: signedIn(STORAGE_STATE_2) });
      return context.newPage();
    }

    test('reading a conversation clears its unread badge in place, with no page reload @ui', async ({
      page,
      browser,
    }) => {
      const subject = `QA badge ${Date.now()}`;
      const victim = testData.victimKpostId;
      const sender = await openSender(browser);

      // Record the server's count so a failure says whether the API or the UI is wrong.
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

        // Opening the conversation keeps the list (and its badge) on screen.
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

    // The side-menu total refreshes only on a socket event, which the strip can steal (both bind it).
    test('reading a conversation also lowers the side-menu Katchup total, with no page reload @ui', async ({
      page,
      browser,
    }) => {
      const subject = `QA side badge ${Date.now()}`;
      const victim = testData.victimKpostId;
      const sender = await openSender(browser);
      const sideBadge = page.locator('.icon-KP_04-Katchup .Header_msg_count').first();
      const sideCount = async (): Promise<number> => {
        if (!(await sideBadge.isVisible().catch(() => false))) return 0; // hidden = no unread
        const n = parseInt((await sideBadge.innerText().catch(() => '')).replace(/[^\d]/g, ''), 10);
        return Number.isNaN(n) ? 0 : n;
      };

      // The server's TOTAL unread (msgsCount) as this page last fetched it, before and after the read.
      let readAt = Number.POSITIVE_INFINITY;
      let serverBefore: number | undefined;
      let serverAfter: number | undefined;
      let refetchesAfterRead = 0;
      page.on('response', async (r) => {
        if (!isUnreadCount(r.url()) || !r.ok()) return;
        const body = (await r.json().catch(() => ({}))) as { msgsCount?: number };
        if (Date.now() >= readAt) {
          refetchesAfterRead++;
          serverAfter = body.msgsCount ?? 0;
        } else {
          serverBefore = body.msgsCount ?? 0;
        }
      });

      try {
        await openConversation(sender, testData.kpostId);
        await sender.locator('.msg-arrow').first().click();
        await sendMessage(sender, subject, 'QA side-badge probe — safe to ignore');

        await gotoKatchup(page);
        await parkPointerAwayFromSideMenu(page);
        await expect(sideBadge, 'the side-menu Katchup badge shows the unread total').toBeVisible({
          timeout: 30_000,
        });
        await settleFrames(page).catch(() => undefined);
        const before = await sideCount();
        expect(before, 'a fresh unread message gives the side-menu badge a number').toBeGreaterThan(
          0,
        );

        // Read it in-SPA (the side menu stays on screen), then wait up to 10s — NO reload.
        readAt = Date.now();
        await page.locator(`[id="${victim}"], [id^="${victim}-"]`).first().click();
        await parkPointerAwayFromSideMenu(page);
        let after = before;
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          after = await sideCount();
          if (after < before) break;
          await page.waitForTimeout(500);
        }

        const server =
          serverAfter === undefined
            ? `no count re-fetch after the read (server total before=${serverBefore ?? '?'})`
            : `server total before=${serverBefore ?? '?'}, after=${serverAfter} (${refetchesAfterRead} re-fetches)`;
        test.info().annotations.push({
          type: 'observed',
          description: `side-menu Katchup badge: before read=${before}, after read=${after}; ${server}`,
        });
        expect(
          after,
          `the side-menu Katchup total must drop after a conversation is read (was ${before}, still ` +
            `${after}; ${server}) — a total that stays put until reload is the reported stale count`,
        ).toBeLessThan(before);
      } finally {
        await page.goto('/katchup', { waitUntil: 'domcontentloaded' }).catch(() => undefined);
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
