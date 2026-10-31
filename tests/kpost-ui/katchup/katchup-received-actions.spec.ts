import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';
import {
  gotoKatchup,
  openReceivedConversation,
  openReplyMenu,
  receivedMessageBySubject,
} from '../support/katchup';

/**
 * Katchup actions on a RECEIVED message (ReplyIcon menu): Transfer, the four Forward variants, Copy,
 * Save, Text-To-Speech and Delete. The 2nd QA account sends via the API (an API login for the browser's
 * own account would kick its session). Gated behind KATCHUP_UI_LIFECYCLE; each test deletes its message.
 */
const SENDER = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'victim');

async function receiveFromSecondAccount(
  endpoints: EndpointExecutor,
  subject: string,
  body: string,
): Promise<void> {
  const ex = await endpoints.sendTo(
    'katchup-send-message',
    { body: sendShape({ receiver: testData.kpostId, subject, actualMessage: body }) },
    { label: 'received-actions:send', auth: { principal: SENDER! }, allowLiveWrite: true },
  );
  expect(ex.status, `the 2nd account's message is accepted (${ex.status})`).toBeLessThan(300);
}

async function openReceived(page: Page, subject: string) {
  await openReceivedConversation(page, subject);
  const message = receivedMessageBySubject(page, subject);
  await expect(message, 'the received message renders with its action trigger').toBeVisible({
    timeout: 20_000,
  });
  return message;
}

/** Delete a received message from our own view (Delete → Confirm). Best-effort. */
async function deleteReceived(page: Page, subject: string): Promise<void> {
  await gotoKatchup(page).catch(() => undefined);
  await openReceivedConversation(page, subject).catch(() => undefined);
  const message = receivedMessageBySubject(page, subject);
  if (!(await message.count())) return;
  await openReplyMenu(page, message).catch(() => undefined);
  await page
    .getByRole('menuitem', { name: /Delete/i })
    .click({ timeout: 10_000 })
    .catch(() => undefined);
  await page
    .getByRole('dialog')
    .filter({ hasText: /Delete Message/i })
    .getByRole('button', { name: /^Confirm$/i })
    .click({ timeout: 10_000 })
    .catch(() => undefined);
}

const FORWARD_MODES = [
  { id: 'FR-KU-050', item: /Forward\s*$/i, mode: 'Hide Source', thread: false },
  { id: 'FR-KU-051', item: /Forward\s*$/i, mode: 'Reveal Source', thread: false },
  { id: 'FR-KU-052', item: /Forward With Thread/i, mode: 'Hide Source', thread: true },
  { id: 'FR-KU-053', item: /Forward With Thread/i, mode: 'Reveal Source', thread: true },
] as const;

test.describe(
  'KPost Katchup · received-message actions (FR-KU-048..057)',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
    test.describe.configure({ timeout: 150_000 });
    test.skip(
      process.env.KATCHUP_UI_LIFECYCLE !== 'true',
      'writes real messages; set KATCHUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !SENDER ||
        !testData.kpostId ||
        testData.kpostId.includes('qa.bench') ||
        !testData.victimKpostId ||
        testData.victimKpostId.includes('qa.bench'),
      'needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID)',
    );

    test(
      'FR-KU-048 — the received message menu lists every recipient action and no sender-only one @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KU-048' }] },
      async ({ page, endpoints }) => {
        const subject = `QA UI recv menu ${Date.now()}`;
        try {
          await receiveFromSecondAccount(endpoints, subject, 'QA UI received menu — body');
          const message = await openReceived(page, subject);
          await openReplyMenu(page, message);
          const items = page.getByRole('menuitem');
          await expect(items.first(), 'the extended action menu opens').toBeVisible({
            timeout: 15_000,
          });
          for (const name of [
            'Reply',
            'Comment',
            'Clarify',
            'Transfer',
            'Forward',
            'Forward With Thread',
            'Copy',
            'Save',
            'Delete',
            'Print',
            'Text-To-Speech',
          ]) {
            await expect(
              items.filter({ hasText: new RegExp(`^\\s*${name}\\s*$`, 'i') }),
              `the menu offers ${name}`,
            ).toHaveCount(1);
          }
          for (const senderOnly of ['Edit', 'Recall']) {
            await expect(
              items.filter({ hasText: new RegExp(`^\\s*${senderOnly}\\s*$`, 'i') }),
              `${senderOnly} is not offered on a message the user did not send`,
            ).toHaveCount(0);
          }
          await page.keyboard.press('Escape');
        } finally {
          await deleteReceived(page, subject);
        }
      },
    );

    test(
      'FR-KU-049 — Transfer opens the Transfer Message picker for a received message @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KU-049' }] },
      async ({ page, endpoints }) => {
        const subject = `QA UI recv transfer ${Date.now()}`;
        try {
          await receiveFromSecondAccount(endpoints, subject, 'QA UI received transfer — body');
          const message = await openReceived(page, subject);
          await openReplyMenu(page, message);
          await page.getByRole('menuitem', { name: /Transfer/i }).click();
          await expect(
            page.getByRole('dialog').filter({ hasText: /Transfer Message/i }),
            'the Transfer Message modal opens',
          ).toBeVisible({ timeout: 15_000 });
        } finally {
          await deleteReceived(page, subject);
        }
      },
    );

    for (const variant of FORWARD_MODES) {
      test(`${variant.id} — ${variant.thread ? 'Forward With Thread' : 'Forward'} offers ${variant.mode} and the mode can be selected @ui`, async ({
        page,
        endpoints,
      }) => {
        const subject = `QA UI recv fwd ${variant.id} ${Date.now()}`;
        try {
          await receiveFromSecondAccount(
            endpoints,
            subject,
            `QA UI received forward — ${variant.id}`,
          );
          const message = await openReceived(page, subject);
          await openReplyMenu(page, message);
          const item = page.getByRole('menuitem').filter({ hasText: variant.item }).first();
          await expect(item, 'the menu offers the forward action').toBeVisible({ timeout: 15_000 });
          await item.click();

          // The forward view: the two source modes, Reveal Source checked by default.
          const hide = page.getByLabel(/Hide Source/i).first();
          const reveal = page.getByLabel(/Reveal Source/i).first();
          await expect(hide, 'Hide Source is offered').toBeVisible({ timeout: 15_000 });
          await expect(reveal, 'Reveal Source is offered').toBeVisible();
          await expect(reveal, 'Reveal Source is the default').toBeChecked();
          if (variant.thread) {
            await expect(
              page.getByText(/Forward With All Threads/i).first(),
              'the thread variant forwards the whole thread',
            ).toBeVisible();
          }
          if (variant.mode === 'Hide Source') {
            await hide.check();
            await expect(hide, 'Hide Source is selected').toBeChecked();
            await expect(reveal, 'Reveal Source is cleared').not.toBeChecked();
          } else {
            await expect(reveal).toBeChecked();
          }
          test.info().annotations.push({
            type: 'observed',
            description: `${variant.id}: mode controls present; selected "${variant.mode}" (recipient send is covered by katchup-forward-subflow-e2e)`,
          });
        } finally {
          await deleteReceived(page, subject);
        }
      });
    }

    test(
      'FR-KU-054 — Copy puts the received message on the clipboard and confirms with a toast @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KU-054' }] },
      async ({ page, endpoints, context }) => {
        const subject = `QA UI recv copy ${Date.now()}`;
        const body = `QA UI received copy — ${Date.now()}`;
        await context
          .grantPermissions(['clipboard-read', 'clipboard-write'])
          .catch(() => undefined);
        try {
          await receiveFromSecondAccount(endpoints, subject, body);
          const message = await openReceived(page, subject);
          await openReplyMenu(page, message);
          await page.getByRole('menuitem', { name: /Copy/i }).click();
          await expect(
            page.getByText(/copied to clipboard/i).first(),
            'a clipboard toast confirms the copy',
          ).toBeVisible({ timeout: 10_000 });
          const clip = await page
            .evaluate(() => navigator.clipboard.readText())
            .catch(() => '(clipboard not readable in this browser)');
          test
            .info()
            .annotations.push({ type: 'observed', description: `clipboard: ${clip.slice(0, 80)}` });
          if (!clip.startsWith('('))
            expect(clip, 'the clipboard holds the message text').toContain(body);
        } finally {
          await deleteReceived(page, subject);
        }
      },
    );

    test(
      'FR-KU-055 — Save asks for confirmation first; cancelling keeps the folder untouched @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KU-055' }] },
      async ({ page, endpoints }) => {
        const subject = `QA UI recv save ${Date.now()}`;
        // Save opens a native confirm; accepting would delete every other message in the shared QA
        // conversation, so the test checks the confirm and dismisses it.
        const confirms: string[] = [];
        page.on('dialog', (d) => {
          confirms.push(`${d.type()}: ${d.message()}`);
          void d.dismiss();
        });
        let saveRequests = 0;
        page.on('request', (r) => {
          if (r.url().includes('/katchup/saveKatchupMessages/')) saveRequests++;
        });
        try {
          await receiveFromSecondAccount(endpoints, subject, 'QA UI received save — body');
          const message = await openReceived(page, subject);
          await openReplyMenu(page, message);
          await page
            .getByRole('menuitem')
            .filter({ hasText: /^\s*Save\s*$/i })
            .first()
            .click();
          // Older builds: a native confirm (dismissed above). Since 2026-10-31: a page dialog
          // "... Message Folder Please confirm" with Cancel / Confirm, which is cancelled here.
          const pageDialog = page
            .getByRole('dialog')
            .filter({ hasText: /Message Folder|Please confirm/i })
            .last();
          await expect
            .poll(
              async () => confirms.length > 0 || (await pageDialog.isVisible().catch(() => false)),
              { message: 'Save opens a Save Messages confirmation dialog', timeout: 15_000 },
            )
            .toBe(true);
          if (!confirms.length) {
            confirms.push(`confirm: ${(await pageDialog.innerText()).replace(/\s+/g, ' ')}`);
            await pageDialog.getByRole('button', { name: /^Cancel$/i }).click();
          }
          test.info().annotations.push({ type: 'observed', description: confirms.join(' || ') });
          expect(confirms[0], 'the dialog is a confirm about saving the selected message').toMatch(
            /confirm: .*(saved|Message Folder)/i,
          );
          await page
            .waitForRequest((r) => r.url().includes('/katchup/saveKatchupMessages/'), {
              timeout: 1_500,
            })
            .catch(() => undefined);
          expect(saveRequests, 'cancelling the confirmation saves nothing').toBe(0);
        } finally {
          await deleteReceived(page, subject);
        }
      },
    );

    test(
      'FR-KU-056 — Text-To-Speech opens the playback screen and reads the message aloud @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KU-056' }] },
      async ({ page, endpoints }) => {
        const subject = `QA UI recv tts ${Date.now()}`;
        const body = 'QA UI received text to speech body';
        // Record what the app hands to the speech engine instead of relying on audio hardware.
        await page.addInitScript(() => {
          const spoken: string[] = [];
          (window as unknown as { __qaSpoken: string[] }).__qaSpoken = spoken;
          const synth = window.speechSynthesis;
          if (!synth) return;
          const original = synth.speak.bind(synth);
          synth.speak = (u: SpeechSynthesisUtterance) => {
            spoken.push(u.text);
            try {
              original(u);
            } catch {
              /* no audio device in CI */
            }
          };
        });
        try {
          await receiveFromSecondAccount(endpoints, subject, body);
          const message = await openReceived(page, subject);
          await openReplyMenu(page, message);
          await page.getByRole('menuitem', { name: /Text-To-Speech/i }).click();
          await expect(
            page.locator('.tts-modal-advanced').first(),
            'the TTS playback screen opens',
          ).toBeVisible({ timeout: 10_000 });
          await expect
            .poll(
              () =>
                page.evaluate(
                  () => (window as unknown as { __qaSpoken: string[] }).__qaSpoken ?? [],
                ),
              { message: 'the message text is handed to the speech engine', timeout: 10_000 },
            )
            .toContainEqual(expect.stringContaining(body));
          await expect(
            page.locator('.tts-actions .tts-btn').first(),
            'playback controls (stop / pause / cancel) are offered',
          ).toBeVisible();
          await page
            .locator('.tts-actions .tts-btn')
            .last()
            .click()
            .catch(() => undefined);
        } finally {
          await deleteReceived(page, subject);
        }
      },
    );

    test(
      'FR-KU-057 — Delete removes a received message from the view after confirmation @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KU-057' }] },
      async ({ page, endpoints }) => {
        const subject = `QA UI recv delete ${Date.now()}`;
        await receiveFromSecondAccount(endpoints, subject, 'QA UI received delete — body');
        const message = await openReceived(page, subject);
        await openReplyMenu(page, message);
        await page.getByRole('menuitem', { name: /Delete/i }).click();
        const confirm = page.getByRole('dialog').filter({ hasText: /Delete Message/i });
        await expect(confirm, 'the Delete Message confirmation opens').toBeVisible({
          timeout: 10_000,
        });
        await expect(
          confirm.getByRole('button', { name: /^Cancel$/i }),
          'offers Cancel',
        ).toBeVisible();
        await confirm.getByRole('button', { name: /^Confirm$/i }).click();
        await expect(message, 'the message is removed from the user’s view').toBeHidden({
          timeout: 15_000,
        });
      },
    );
  },
);
