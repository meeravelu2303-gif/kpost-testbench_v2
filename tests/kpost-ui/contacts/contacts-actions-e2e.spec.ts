import type { Locator, Page, Response } from '@playwright/test';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { gotoKatchup } from '../support/katchup';

/**
 * Contacts on screen, each server answer checked: from a contact's Digital Card, add a reference,
 * block (then unblock from Settings › Blocked Contacts) and delete; and add an unknown sender from
 * the thread header. The subject is qatest4 (personal-4), never signed in in a browser, so its API
 * calls cannot sign anyone out; the browser account's own API calls reuse its browser session.
 * Selectors from bubble/DigitalCard, bubble/AddReference, bubble/BlockContact, bubble/DeleteContact,
 * bubble/AddContact and Settings/BlockedContact.
 */
const K = AUTH_PROFILES.kpost;
const ME: Principal | undefined = K.principals.find((p) => p.key === 'personal'); // the browser
const OTHER: Principal | undefined = K.principals.find((p) => p.key === 'personal-4');

async function answerTo(page: Page, path: string, act: () => Promise<void>): Promise<Response> {
  const answer = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes(path),
    { timeout: 30_000 },
  );
  await act();
  return answer;
}
const envelope = async (r: Response) =>
  (await r.json().catch(() => ({}))) as { status?: string; message?: string };
const sent = (r: Response): Record<string, unknown> =>
  JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>;
const dialog = (page: Page, title: string): Locator =>
  page.locator('.modal-dialog', { hasText: title }).last();

/** As the browser's account (its session is reused): make OTHER a contact, unblocked. */
async function ensureContact(endpoints: EndpointExecutor): Promise<void> {
  await endpoints.sendTo(
    'contacts-add',
    {
      body: {
        contactID: OTHER!.username,
        firstName: 'qatest4',
        lastName: 'Bench',
        referenceName: '',
        userType: 'PERSONAL',
      },
    },
    { label: 'contacts-e2e:setup-add', allowLiveWrite: true, ownedIdentifiers: [OTHER!.username] },
  );
  await unblock(endpoints);
}
async function unblock(endpoints: EndpointExecutor): Promise<void> {
  await endpoints
    .sendTo(
      'contacts-block',
      { body: { contactID: OTHER!.username, isBlocked: false } },
      { label: 'contacts-e2e:unblock', allowLiveWrite: true, ownedIdentifiers: [OTHER!.username] },
    )
    .catch(() => undefined);
}
async function removeContact(endpoints: EndpointExecutor): Promise<void> {
  await endpoints
    .sendTo(
      'contacts-delete',
      { body: { contactID: OTHER!.username } },
      { label: 'contacts-e2e:cleanup', allowLiveWrite: true, ownedIdentifiers: [OTHER!.username] },
    )
    .catch(() => undefined);
}

/** Katchup contact rail → the person's avatar → their Digital Card. */
async function openDigitalCard(page: Page): Promise<Locator> {
  await gotoKatchup(page);
  const search = page.getByRole('searchbox').first();
  await search.fill('qatest4').catch(() => undefined);
  const row = page
    .locator('.contactBar_Dropdown')
    .filter({ hasText: /qatest4/i })
    .first();
  const card = page.locator('.DC-modal-40w').first();
  const opened = page.waitForResponse((r) => r.url().includes('/profile/getDigitalCard'), {
    timeout: 30_000,
  });
  await row.locator('.sb-avatar').first().click();
  await opened;
  await expect(card, "the person's Digital Card opens").toBeVisible({ timeout: 15_000 });
  return card;
}

test.describe(
  'KPost Contacts · Digital Card and contact actions on screen @ui',
  { tag: ['@ui', '@contacts', '@regression'] },
  () => {
    test.describe.configure({ mode: 'default', timeout: 180_000 });
    test.skip(
      process.env.CONTACTS_UI_LIFECYCLE !== 'true',
      'changes real contacts; set CONTACTS_UI_LIFECYCLE=true',
    );
    test.skip(!ME || !OTHER, 'needs the primary and personal-4 QA accounts');

    test('a reference name is added to a contact from their Digital Card', async ({
      page,
      endpoints,
    }) => {
      await ensureContact(endpoints);
      try {
        const card = await openDigitalCard(page);
        const reference = `QA Ref ${Date.now()}`;
        await card
          .locator('button.dc-specialty-chip')
          .filter({ hasText: /Reference|QA Ref/ })
          .first()
          .click();
        const editor = page
          .locator('.modal-dialog')
          .filter({ has: page.getByPlaceholder('Add Reference') })
          .last();
        await editor.getByPlaceholder('Add Reference').fill(reference);
        const saved = await answerTo(page, '/contacts/addContactReference', () =>
          editor.getByRole('button', { name: /^Save$/ }).click(),
        );
        expect.soft(sent(saved).referenceName, 'the reference is sent as typed').toBe(reference);
        expect.soft((await envelope(saved)).status, 'the server saves it').toBe('SUCCESS');
        await expect
          .soft(card.getByText(reference).first(), 'the card shows the new reference')
          .toBeVisible({ timeout: 15_000 });
      } finally {
        await removeContact(endpoints);
      }
    });

    test('a contact blocked from their Digital Card is unblocked from Settings › Blocked Contacts', async ({
      page,
      endpoints,
      settingsPage,
    }) => {
      await ensureContact(endpoints);
      try {
        await test.step('Block Contact › Block', async () => {
          const card = await openDigitalCard(page);
          await card.getByRole('button', { name: 'Block Contact' }).click();
          const confirm = dialog(page, 'Block Contact');
          const blocked = await answerTo(page, '/contacts/blockOrUnBlockContact', () =>
            confirm.getByRole('button', { name: /^Block$/ }).click(),
          );
          expect.soft(sent(blocked).isBlocked, 'the screen asks to block').toBe(true);
          expect.soft((await envelope(blocked)).status, 'the server blocks').toBe('SUCCESS');
          await expect
            .soft(
              card.getByRole('button', { name: 'Unblock Contact' }),
              'the card now offers Unblock',
            )
            .toBeVisible({ timeout: 15_000 });
        });

        await test.step('Settings › General Settings › Blocked Contacts › Unblock › Unblock', async () => {
          await settingsPage.goto();
          await settingsPage.openPanel('General Settings', 'Blocked Contacts');
          const row = page
            .locator('.contactBar_Dropdown')
            .filter({ hasText: /qatest4/i })
            .first();
          await expect(row, 'the blocked person is listed').toBeVisible({ timeout: 20_000 });
          await row.getByRole('button', { name: /^Unblock$/ }).click();
          const confirm = dialog(page, 'Unblock Contact');
          const unblocked = await answerTo(page, '/contacts/blockOrUnBlockContact', () =>
            confirm.getByRole('button', { name: /^Unblock$/ }).click(),
          );
          expect.soft(sent(unblocked).isBlocked, 'the screen asks to unblock').toBe(false);
          expect.soft((await envelope(unblocked)).status, 'the server unblocks').toBe('SUCCESS');
          await expect.soft(row, 'the row leaves the blocked list').toBeHidden({ timeout: 15_000 });
        });
      } finally {
        await unblock(endpoints);
        await removeContact(endpoints);
      }
    });

    test('a contact is deleted from their Digital Card', async ({ page, endpoints }) => {
      await ensureContact(endpoints);
      try {
        const card = await openDigitalCard(page);
        await card.getByRole('button', { name: 'Delete Contact' }).click();
        const confirm = dialog(page, 'Delete Contact');
        const deleted = await answerTo(page, '/contacts/deleteContact', () =>
          confirm.getByRole('button', { name: /^Confirm$/ }).click(),
        );
        expect.soft(sent(deleted).contactID, 'the right person is deleted').toBe(OTHER!.username);
        expect
          .soft((await envelope(deleted)).status, 'the server deletes the contact')
          .toBe('SUCCESS');
        await expect
          .soft(
            card.getByRole('button', { name: 'Delete Contact' }),
            'the card no longer offers Delete',
          )
          .toBeHidden({ timeout: 15_000 });
      } finally {
        await removeContact(endpoints);
      }
    });

    test('a message from someone not in the contacts offers Add Contact, which adds them', async ({
      page,
      endpoints,
    }) => {
      await removeContact(endpoints);
      const subject = `QA unknown sender ${Date.now()}`;
      let msgID: number | undefined;
      try {
        // personal-4 is never signed in in a browser, so this API login signs no one out.
        const sentMsg = await endpoints.sendTo(
          'katchup-send-message',
          {
            body: {
              receiver: ME!.username,
              messageType: 0,
              subject,
              actualMessage: 'QA bench message from an unknown sender, safe to ignore.',
              messageTime: Date.now(),
              serverTime: Date.now(),
              status: 0,
              sessionID: 'Web-Reactjs',
              groupFlag: 'false',
              groupmemberList: [],
              selectedMembers: 'N',
              isVanished: false,
              sharedType: 0,
              temporaryMsgID: 0,
              uuid: [],
              isHtml: false,
              isVoiceMessage: false,
            },
          },
          {
            label: 'contacts-e2e:unknown-sender',
            auth: { principal: OTHER! },
            allowLiveWrite: true,
            ownedIdentifiers: [ME!.username],
          },
        );
        const json = sentMsg.json();
        const rows =
          (json.ok ? (json.value as { data?: Array<{ msgID?: number }> }).data : []) ?? [];
        msgID = rows[0]?.msgID;
        expect(msgID, 'the unknown sender’s message was sent (setup)').toBeTruthy();

        await gotoKatchup(page);
        await page.getByText(subject).first().click({ timeout: 30_000 });
        const add = page.locator('#ChatTop').getByText('Add Contact', { exact: true }).first();
        await expect(add, 'the thread header offers Add Contact').toBeVisible({ timeout: 20_000 });
        await add.click();
        const confirm = dialog(page, 'Add To Contact');
        const added = await answerTo(page, '/contacts/addContact', () =>
          confirm.getByRole('button', { name: /^Add$/ }).click(),
        );
        expect.soft(sent(added).contactID, 'the sender is added').toBe(OTHER!.username);
        expect.soft((await envelope(added)).status, 'the server adds them').toBe('SUCCESS');
        await expect
          .soft(
            page
              .locator('.Toastify__toast')
              .filter({ hasText: /successfully added/ })
              .first(),
          )
          .toBeVisible({ timeout: 10_000 });
      } finally {
        await removeContact(endpoints);
        if (msgID)
          await endpoints
            .sendTo(
              'katchup-delete-message',
              { body: { messageIds: [msgID], groupFlag: false } },
              {
                label: 'contacts-e2e:cleanup-msg',
                auth: { principal: OTHER! },
                allowLiveWrite: true,
              },
            )
            .catch(() => undefined);
      }
    });
  },
);
