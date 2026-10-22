import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Locator, Page } from '@playwright/test';
import { messageBySubject, openComposer, openConversation, sendMessage } from './support/katchup';
import { settleFrames } from './support/settle';

/** Same real forward target as the single-forward sub-flow test (katchup-forward-subflow-e2e) —
 * Forward excludes the open thread's counterpart, so the target must be a different contact. */
const FORWARD_TARGET_CONTACT_ID = 'qatest3@kpostindia.com';
const FORWARD_TARGET_SEARCH_TERM = 'Qatest3';

/**
 * Multi-select Forward (several messages in one forward) — the forward angle the single-forward
 * sub-flow test does not reach. Added 2026-10-14 after a user complaint that "forward is not working":
 * the bell-menu single forward passes, so this covers the other real entry point.
 *
 * Read directly from source (bubble/KatchupMessage/KatchupMessage.js, bubble/MessageBox/MessageBox.js,
 * bubble/forwardFooter/ForwardFooter.js):
 *   1. The thread header's "More" icon (`.icon-KP_59-More-Lined`) switches the thread into select mode
 *      (`setCheckBoxValue(true)` + `forwardMessage: true`): every message gets its own checkbox
 *      (`.message-select-box input`, next to the subject in `.message-topbar`), and the forward footer
 *      shows "Selected Messages: N / 5" (`role="status"`), "Select All" and a Forward button
 *      (`.blueBack` holding `.icon-KP_119-Forward`).
 *   2. With more than one message ticked, Forward (`handleForwardShow`) opens the forward write view;
 *      its "Forward To" text (`.forwardtextto`) opens the same MultipleContact picker as single forward.
 *   3. The send button (`.post_button_size`, no accessible name — #963) calls `sendMultiForward`, which
 *      POSTs every selected msgID in one `POST /v2/katchup/forwardKatchupMultipleMsgs/` and toasts
 *      "Message Forward successfully" on `status: "SUCCESS"`.
 *   4. Limit: more than 5 selected (`MAX_FORWARD_MESSAGES`) must be refused with "Only up to 5 messages
 *      can be forwarded at a time" — nothing is sent.
 *
 * Live 2026-10-14: the multi-forward WORKS — HTTP 200 SUCCESS, the server creates one forwarded copy
 * per selected message (messageType 15, the original carried as a quoted `referenceMessage`), and both
 * show in the target's thread. Each copy's subject is "General", not the original subject.
 *
 * Source suspects this test is designed to expose (ForwardFooter.js): the send handler fires
 * `sendMultiForward()` WITHOUT await and immediately calls `handleClose()`, and a failed send only
 * shows a generic toast. So the test reads the server's real response, then verifies delivery in the
 * target's thread — a toast alone is not proof.
 */
test.describe(
  'KPost Katchup · Multi-select forward @ui',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
    test.skip(
      process.env.KATCHUP_UI_LIFECYCLE !== 'true',
      'sends and forwards real messages; set KATCHUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts',
    );

    /** The checkbox select mode gives the message whose subject is `subject`. */
    const selectBoxFor = (page: Page, subject: string) =>
      page
        .locator('.message-topbar')
        .filter({ hasText: subject })
        .locator('.message-select-box input[type="checkbox"]')
        .first();

    /** Switch the open thread into select mode via the header's "More" icon. */
    async function enterSelectMode(page: Page): Promise<void> {
      await page.locator('.icon-KP_59-More-Lined').first().click({ timeout: 15_000 });
      await expect(
        page.getByRole('status').filter({ hasText: /Selected Messages/i }),
        'select mode shows the "Selected Messages: N / 5" counter',
      ).toBeVisible({ timeout: 15_000 });
    }

    /** Delete one sent message (bell → Delete → Confirm), skipping quietly if it is not on screen. */
    async function deleteMessage(message: Locator): Promise<void> {
      const page = message.page();
      if (!(await message.isVisible({ timeout: 5_000 }).catch(() => false))) return;
      await message.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);
      await message.hover({ timeout: 5_000 }).catch(() => undefined);
      const bell = message.getByTestId('NotificationsNoneIcon').first();
      if (
        !(await bell.click({ force: true, timeout: 5_000 }).then(
          () => true,
          () => false,
        ))
      )
        return;
      await page
        .getByRole('menuitem', { name: /Delete/i })
        .click({ timeout: 5_000 })
        .catch(() => undefined);
      await page
        .getByRole('button', { name: /^Confirm$/i })
        .click({ timeout: 5_000 })
        .catch(() => undefined);
    }

    const footerForward = (page: Page) =>
      page
        .locator('.blueBack')
        .filter({ has: page.locator('.icon-KP_119-Forward') })
        .first();

    test('two selected messages forward together in one send and both arrive @ui', async ({
      page,
    }) => {
      const stamp = Date.now();
      const subjectA = `QA multi-forward A ${stamp}`;
      const subjectB = `QA multi-forward B ${stamp}`;
      const bodyA = `QA multi-forward body A ${stamp}`;
      const bodyB = `QA multi-forward body B ${stamp}`;
      // Two sends + select + picker + delivery check + cleanup in two threads.
      test.setTimeout(150_000);
      // The forwarded copies' msgIDs, from the server's response — used to clean them up. (Live
      // 2026-10-14: a forwarded copy gets the subject "General", not the original subject, so it cannot
      // be found by subject; a message's DOM `id` is its msgID.)
      let forwardedIds: number[] = [];

      await openComposer(page);
      await sendMessage(page, subjectA, bodyA);
      await sendMessage(page, subjectB, bodyB);

      try {
        await enterSelectMode(page);
        for (const subject of [subjectA, subjectB]) {
          const box = selectBoxFor(page, subject);
          await box.scrollIntoViewIfNeeded().catch(() => undefined);
          await box.check();
        }
        await expect(
          page.getByRole('status').filter({ hasText: /Selected Messages/i }),
          'the counter reflects exactly the two ticked messages',
        ).toContainText(/Selected Messages:\s*2\s*\/\s*5/i);

        await footerForward(page).click();
        await page.locator('.forwardtextto, .moveforwardtextto').first().click({ timeout: 15_000 });

        const recipientDialog = page.getByRole('dialog').filter({ hasText: 'Forward To' });
        await expect(recipientDialog, 'the Forward To recipient picker opens').toBeVisible({
          timeout: 15_000,
        });
        await recipientDialog.getByRole('searchbox').fill(FORWARD_TARGET_SEARCH_TERM);
        await settleFrames(page);
        await expect(
          recipientDialog.getByText(FORWARD_TARGET_SEARCH_TERM, { exact: false }).first(),
          `the search narrows the picker to ${FORWARD_TARGET_SEARCH_TERM}`,
        ).toBeVisible({ timeout: 10_000 });
        await recipientDialog.getByRole('checkbox').last().check();
        await recipientDialog.getByRole('button', { name: /^Done$/i }).click();
        await settleFrames(page);

        const send = page.locator('.post_button_size').last();
        await expect(
          send,
          'the forward send button is enabled once a recipient is picked',
        ).toBeEnabled({ timeout: 10_000 });
        const forwarded = page.waitForResponse(
          (r) => r.url().includes('/katchup/forwardKatchupMultipleMsgs'),
          { timeout: 30_000 },
        );
        await send.click();
        const response = await forwarded;
        const sent = response.request().postDataJSON() as { forwardMessageIDList?: unknown[] };
        const body = (await response.json().catch(() => ({}))) as {
          status?: string;
          message?: string;
          data?: { msgID?: number }[];
        };
        forwardedIds = (body.data ?? []).map((m) => m.msgID).filter((id): id is number => !!id);
        test.info().annotations.push({
          type: 'observed',
          description: `forwardKatchupMultipleMsgs HTTP ${response.status()} status=${body.status ?? '?'} message=${body.message ?? ''}; ${sent.forwardMessageIDList?.length ?? 0} msgIDs sent`,
        });
        expect(
          sent.forwardMessageIDList?.length,
          'the UI sent both selected messages in the one multi-forward request',
        ).toBe(2);
        expect(
          { http: response.status(), status: body.status },
          'the server accepted the multi-forward',
        ).toEqual({ http: 200, status: 'SUCCESS' });

        // Delivery, not just the toast: both bodies must show in the sender's own thread with the target.
        await openConversation(page, FORWARD_TARGET_CONTACT_ID);
        for (const text of [bodyA, bodyB]) {
          await expect(
            page.getByText(text, { exact: false }).first(),
            `the forwarded message "${text}" appears in the target's thread`,
          ).toBeVisible({ timeout: 20_000 });
        }
      } finally {
        // Best-effort, time-boxed self-clean (a missing message must never hang the test): the forwarded
        // copies by msgID in the target thread, then the two source messages in the victim thread.
        await page.keyboard.press('Escape').catch(() => undefined);
        if (forwardedIds.length) {
          await openConversation(page, FORWARD_TARGET_CONTACT_ID).catch(() => undefined);
          for (const id of forwardedIds) {
            await deleteMessage(page.locator(`[id="${id}"]`).first());
          }
        }
        await openConversation(page, testData.victimKpostId).catch(() => undefined);
        for (const subject of [subjectA, subjectB]) {
          await deleteMessage(messageBySubject(page, subject));
        }
      }
    });

    test('selecting more than 5 messages is refused before anything is sent @ui', async ({
      page,
    }) => {
      await openConversation(page, testData.victimKpostId);
      await enterSelectMode(page);

      // Any forward request at all would mean the limit was bypassed.
      let forwardSent = false;
      page.on('request', (r) => {
        if (/\/katchup\/forward/i.test(r.url())) forwardSent = true;
      });

      // Select All selects every LOADED message (`handleSelectAll` over messageArr), which can be more
      // than the checkboxes on screen — so read how many it picked from the app's own counter.
      await page.locator('.selectAllCheck').first().check();
      const counter = page.getByRole('status').filter({ hasText: /Selected Messages/i });
      await expect(counter, 'Select All updates the counter').toContainText(/:\s*[1-9]/, {
        timeout: 10_000,
      });
      const selected = Number(/:\s*(\d+)/.exec((await counter.textContent()) ?? '')?.[1] ?? 0);
      test.skip(
        selected <= 5,
        `Select All only picked ${selected} messages here — need 6+, nothing to test right now`,
      );
      await expect(counter, 'the counter flags the selection as over the limit').toHaveClass(
        /forward-selection-count--over-limit/,
      );

      await footerForward(page).click();
      await expect(
        page
          .getByText('Only up to 5 messages can be forwarded at a time', { exact: false })
          .first(),
        'the app warns about the 5-message limit',
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        page.locator('.forwardtextto, .moveforwardtextto'),
        'the forward write view does not open over the limit',
      ).toHaveCount(0);
      expect(forwardSent, 'no forward request was sent over the limit').toBe(false);
    });
  },
);
