import { STORAGE_STATE_2 } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  deleteSentMessage,
  openBellMenu,
  openComposer,
  openConversation,
  openReceivedConversation,
  openReplyMenu,
  sendMessage,
} from '../support/katchup';

/**
 * Katchup per-message action menus (sender bell / recipient reply arrow), Transfer to KMail or an
 * outside app, and the Translate icon, each asserted by its result. Gated behind KATCHUP_UI_LIFECYCLE.
 */
const SENDER_ACTIONS = [
  'Edit',
  'Note',
  'Reminder',
  'Transfer',
  'Forward',
  'Copy',
  'Save',
  'Delete',
  'Print',
  'Text-To-Speech',
];
const RECIPIENT_ACTIONS = [
  'Reply',
  'Comment',
  'Clarify',
  'Transfer',
  'Forward',
  'Copy',
  'Save',
  'Delete',
  'Print',
  'Text-To-Speech',
];

async function menuItems(page: Page): Promise<string[]> {
  const items = page.locator('#long-menu [role="menuitem"]');
  await expect(items.first(), 'the action menu opens').toBeVisible({ timeout: 15_000 });
  return (await items.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
}

async function sendOne(
  page: Page,
  label: string,
  body: string,
): Promise<{ subject: string; message: Locator }> {
  const subject = `QA UI ${label} ${Date.now()}`;
  await openComposer(page);
  const message = await sendMessage(page, subject, body);
  return { subject, message };
}

test.describe(
  'KPost Katchup · action menus, Transfer and Translate (write)',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
    test.describe.configure({ timeout: 180_000 });
    test.skip(
      process.env.KATCHUP_UI_LIFECYCLE !== 'true',
      'writes real messages; set KATCHUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID)',
    );

    test(
      'the sender and the recipient each get their full action menu on a message @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KU-025..026' }] },
      async ({ page, browser }) => {
        const { subject, message } = await sendOne(page, 'menus', 'QA UI menus — self-cleaning');
        try {
          await openBellMenu(page, message);
          const mine = await menuItems(page);
          test
            .info()
            .annotations.push({ type: 'observed', description: `bell: ${mine.join(' | ')}` });
          for (const action of SENDER_ACTIONS)
            expect(mine, `the sender's menu offers ${action}`).toContainEqual(
              expect.stringMatching(new RegExp(`^${action}$`, 'i')),
            );
          await page.keyboard.press('Escape');

          const b = await browser.newContext({ storageState: STORAGE_STATE_2 });
          try {
            const bPage = await b.newPage();
            await openReceivedConversation(bPage, subject);
            const received = bPage
              .locator('[id]')
              .filter({ hasText: subject })
              .filter({ has: bPage.getByTestId('ReplyIcon') })
              .last();
            await openReplyMenu(bPage, received);
            const theirs = await menuItems(bPage);
            test.info().annotations.push({
              type: 'observed',
              description: `reply menu: ${theirs.join(' | ')}`,
            });
            for (const action of RECIPIENT_ACTIONS)
              expect(theirs, `the recipient's menu offers ${action}`).toContainEqual(
                expect.stringMatching(new RegExp(`^${action}$`, 'i')),
              );
          } finally {
            await b.close();
          }
        } finally {
          await openConversation(page, testData.victimKpostId).catch(() => undefined);
          await deleteSentMessage(page, subject).catch(() => undefined);
        }
      },
    );

    test(
      'Transfer sends the message on to KMail or to an outside app @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KU-034' }] },
      async ({ page }) => {
        const { subject, message } = await sendOne(
          page,
          'transfer',
          'QA UI transfer — self-cleaning',
        );
        try {
          const openTransfer = async () => {
            await openBellMenu(page, messageFor(page, subject, message));
            await page.getByRole('menuitem', { name: /Transfer/i }).click();
            const sheet = page.getByRole('dialog').filter({ hasText: /Transfer Message/i });
            await expect(sheet, 'the Transfer sheet opens').toBeVisible({ timeout: 15_000 });
            return sheet;
          };

          // An outside app: the tile opens it in a new tab, carrying the message.
          const sheet = await openTransfer();
          await expect(
            sheet.getByText(/Other Applications/i),
            'outside apps are offered',
          ).toBeVisible();
          const popup = page.waitForEvent('popup', { timeout: 15_000 });
          await sheet
            .locator('.Application-label', { hasText: /^Gmail$/i })
            .first()
            .click();
          const tab = await popup;
          const url = decodeURIComponent(tab.url()).replace(/\+/g, ' ');
          test
            .info()
            .annotations.push({ type: 'observed', description: `Gmail tab: ${url.slice(0, 200)}` });
          expect(url, 'Gmail opens').toContain('mail.google.com');
          expect(url, 'with the message subject in it').toContain(subject);
          await tab.close();

          // KMail: the compose page opens prefilled with the message.
          await page.keyboard.press('Escape').catch(() => undefined);
          await openConversation(page, testData.victimKpostId);
          const again = await openTransfer();
          await again
            .getByText(/^KMail$/)
            .first()
            .click();
          await expect(page, 'KMail compose opens').toHaveURL(/\/writemail/, { timeout: 20_000 });
          await expect(
            // KMail compose's Subject box (journeys/support/journey.ts sendMailFromUi).
            page.locator('.toInput').first(),
            'with the message subject already filled in',
          ).toHaveValue(new RegExp(subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), {
            timeout: 15_000,
          });
        } finally {
          await openConversation(page, testData.victimKpostId).catch(() => undefined);
          await deleteSentMessage(page, subject).catch(() => undefined);
        }
      },
    );

    test(
      'Translate shows the message in the chosen language, under the original @ui',
      { annotation: [{ type: 'requirement', description: 'RTM-KU-M06' }] },
      async ({ page }) => {
        const { subject, message } = await sendOne(
          page,
          'translate',
          'Good morning, how are you today?',
        );
        // The translator call itself (KMail service), recorded so a failure says what it answered.
        const translatorCalls: string[] = [];
        page.on('response', (r) => {
          if (!r.url().includes('/translator/translation')) return;
          void r
            .text()
            .then((t) =>
              translatorCalls.push(
                `${r.status()} sent ${r.request().postData()?.slice(0, 200)} → ${t.slice(0, 300)}`,
              ),
            )
            .catch(() => undefined);
        });
        try {
          await message.scrollIntoViewIfNeeded().catch(() => undefined);
          await message.hover().catch(() => undefined);
          await message.locator('.icon-KP_75-translate').first().click({ force: true });
          const picker = page.getByRole('dialog').filter({ hasText: /Translate/i });
          await expect(picker, 'the Translate language list opens').toBeVisible({
            timeout: 15_000,
          });
          await picker.getByPlaceholder(/Search Language/i).fill('Tamil');
          await picker.locator('.language_Font', { hasText: /Tamil/i }).first().click();
          await expect(
            message.getByText(/▶/).first(),
            'the message shows "<from> ▶ <to>" once translated (#13209 / #13210: langFrom required)',
          ).toBeVisible({ timeout: 30_000 });
          await expect(
            message.locator('.para_font').filter({ hasText: /[஀-௿]/ }).first(),
            'and the translated text, in Tamil script',
          ).toBeVisible({ timeout: 30_000 });
        } finally {
          test.info().annotations.push({
            type: 'observed',
            description: `translator: ${translatorCalls.join(' || ') || 'no call seen'}`,
          });
          await deleteSentMessage(page, subject).catch(() => undefined);
        }
      },
    );
  },
);

/** The sent message again (the thread may have re-rendered since it was first located). */
function messageFor(page: Page, subject: string, fallback: Locator): Locator {
  return page
    .locator('[id]')
    .filter({ hasText: subject })
    .filter({ has: page.getByTestId('NotificationsNoneIcon') })
    .last()
    .or(fallback);
}
