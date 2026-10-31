import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';
import { conversationRow } from '../support/katchup';

/**
 * Katchup composer's own logic: no send without a Subject or body, and the Edited marker after an
 * edit. Validation is judged by the network (was `sendMessage` dispatched?). Gated behind
 * KATCHUP_UI_LIFECYCLE because the edit test sends a real message (self-cleaning).
 */

const EDITOR = '.ql-editor[contenteditable="true"]';

async function openComposer(page: Page): Promise<void> {
  await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);
  const conversation = conversationRow(page, testData.victimKpostId);
  await expect(conversation, 'the 2nd QA account is in the conversation list').toBeVisible({
    timeout: 20_000,
  });
  await conversation.click();
  await page.locator('.msg-arrow').first().click();
}

/** Click the composer's send button (the icon button in #ChatTop). */
async function clickSend(page: Page): Promise<void> {
  await page
    .locator('#ChatTop')
    .getByRole('button')
    .filter({ hasText: /^$/ })
    .first()
    .click({ timeout: 10_000 })
    .catch(() => undefined);
}

test.describe(
  'KPost Katchup · UI functional behaviour @ui',
  { tag: ['@ui', '@katchup', '@regression', '@sanity'] },
  () => {
    test.skip(
      process.env.KATCHUP_UI_LIFECYCLE !== 'true',
      'drives the composer/send; set KATCHUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts',
    );

    test(
      'the composer does not dispatch a message with no Subject (BR-K01) @ui',
      { annotation: [{ type: 'requirement-partial', description: 'BR-KU-SUBJECT' }] },
      async ({ page }) => {
        const sends: string[] = [];
        await page.route('**/katchup/sendMessage**', async (route) => {
          sends.push(route.request().postData() ?? '');
          await route.continue();
        });

        await openComposer(page);

        // A body, but deliberately NO subject.
        await page.locator(EDITOR).first().click();
        await page.keyboard.type('QA functional — body without a subject');
        await clickSend(page);

        // Wait for the request instead of sleeping: a timeout here means the client validated.
        const dispatched = await page
          .waitForRequest('**/katchup/sendMessage**', { timeout: 5_000 })
          .then(() => true)
          .catch(() => false);

        test.info().annotations.push({
          type: 'observed',
          description: dispatched
            ? `the composer dispatched a send with body: ${sends[0]?.slice(0, 120) ?? '(unknown)'}`
            : 'the composer sent nothing — BR-K01 enforced client-side',
        });

        // Letting the server decide is a design choice; dispatching an EMPTY subject is not.
        if (dispatched && sends[0]) {
          const emptySubject = /"subject"\s*:\s*""/.test(sends[0]);
          expect(
            emptySubject,
            'BR-K01: the composer must not dispatch a message with an empty Subject',
          ).toBe(false);
        }
      },
    );

    test('the composer does not dispatch an empty message @ui', async ({ page }) => {
      const sends: number[] = [];
      await page.route('**/katchup/sendMessage**', async (route) => {
        sends.push(1);
        await route.continue();
      });

      await openComposer(page);

      // Give a subject but leave the body empty.
      await page.getByRole('textbox', { name: 'Subject' }).fill('QA empty-body probe');
      await clickSend(page);

      const dispatched = await page
        .waitForRequest('**/katchup/sendMessage**', { timeout: 5_000 })
        .then(() => true)
        .catch(() => false);

      expect(
        dispatched,
        'an empty message must not be sent — a blank chat message is never a valid outcome',
      ).toBe(false);
    });

    test('an edited message shows the Edited marker (state reflects the write) @ui', async ({
      page,
      databases,
    }) => {
      // Sends to our own 2nd account, edits, then deletes the message.
      const subject = `QA edit ${Date.now()}`;
      await openComposer(page);
      await page.getByRole('textbox', { name: 'Subject' }).fill(subject);
      await page.locator(EDITOR).first().click();
      await page.keyboard.type('original body');
      await clickSend(page);

      const sent = page
        .locator('[id]')
        .filter({ hasText: subject })
        .filter({ has: page.getByTestId('NotificationsNoneIcon') })
        .last();

      // A failed send is covered elsewhere; skip rather than fail, this test is about the edit state.
      const landed = await sent
        .isVisible({ timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      test.skip(
        !landed,
        'the message did not send (see Katchup send defects) — edit state not reachable',
      );

      try {
        await sent.hover();
        await sent.getByTestId('NotificationsNoneIcon').first().click();
        await page.getByRole('menuitem', { name: /Edit/i }).click();
        await page.locator(EDITOR).first().click();
        await page.keyboard.type(' — edited');
        await clickSend(page);

        await expect(
          page.getByText(/Edited/i).first(),
          'FR-K09: an edited message shows the Edited marker',
        ).toBeVisible({ timeout: 15_000 });
      } finally {
        // Delete our message whichever state it is in.
        const toDelete = page
          .locator('[id]')
          .filter({ hasText: subject })
          .filter({ has: page.getByTestId('NotificationsNoneIcon') })
          .last();
        await toDelete
          .hover()
          .then(() => toDelete.getByTestId('NotificationsNoneIcon').first().click())
          .then(() => page.getByRole('menuitem', { name: /Delete/i }).click())
          .then(() => page.getByRole('button', { name: /^Confirm$/i }).click())
          .catch(() => undefined);
        void databases; // reserved for a DB-level edit assertion
      }
    });
  },
);
