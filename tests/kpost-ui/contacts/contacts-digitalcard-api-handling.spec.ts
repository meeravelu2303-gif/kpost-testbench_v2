import { randomUUID } from 'node:crypto';
import type { Locator, Page, Route } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { gotoContacts, openDigitalCard } from '../support/contacts';
import { toast } from '../support/validation';

/**
 * A contact's Digital Card (Katchup bubble DigitalCard.js, BlockContact.js, DeleteContact.js) and
 * the Contacts tab's Invite (ContactList.js): when the server refuses, the user is told. Each call
 * is failed in the browser, so the 2nd QA account is never blocked, unblocked or deleted. The QR
 * share's presign, S3 upload, Katchup send and KMail send are all answered in the browser: no file
 * is uploaded and nothing is shared.
 */
const VICTIM_NAME = testData.victimKpostId.split('@')[0]!;

const failure = (status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify({
    status: 'FAILURE',
    statusCode: status === 200 ? 400 : status,
    message: '',
  }),
});

const success = (data: unknown = {}) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ status: 'SUCCESS', statusCode: 200, message: '', data }),
});

/** Answers the card load with the real card, its `isBlocked` set as the test needs. */
async function seedCardBlocked(page: Page, isBlocked: boolean): Promise<void> {
  await page.route('**/profile/getDigitalCard**', async (route) => {
    const real = await route.fetch();
    const body = (await real.json().catch(() => ({}))) as { data?: Record<string, unknown>[] };
    if (Array.isArray(body.data) && body.data[0]) body.data[0].isBlocked = isBlocked;
    await route.fulfill({ response: real, json: body });
  });
}

/** Made-up recipients for the QR share; they exist only in this browser. */
const RECIPIENT = 'QA QR Recipient';
async function seedRecipients(page: Page): Promise<void> {
  const contact = (i: number) => ({
    id: 991000 + i,
    kpostID: testData.kpostId,
    contactID: `qa.qr.recipient.${i}@kpostindia.com`,
    firstName: RECIPIENT,
    lastName: String(i),
    referenceName: '',
    userType: 'PERSONAL',
    isBlocked: false,
    deleteStatus: false,
    countryID: 1,
    countryCode: '91',
    activeStatus: 'yes',
  });
  await page.route('**/contacts/myContacts/**', async (route) => {
    const real = await route.fetch();
    const body = (await real.json()) as { contacts_added?: unknown[] };
    body.contacts_added = [...(body.contacts_added ?? []), contact(1), contact(2)];
    await route.fulfill({ response: real, json: body });
  });
}

type Answer = (route: Route, call: number) => Promise<void>;

/**
 * Every call the QR share makes, answered in the browser. The presign hands back a same-origin URL
 * (with a UUID, as the screen needs) whose PUT is answered here too; a real S3 host is refused.
 */
async function stubQrShare(
  page: Page,
  answers: { katchupPresign?: Answer; kmailPresign?: Answer; send?: Answer; mail?: Answer },
) {
  const calls = { presign: 0, upload: 0, send: 0, mail: 0, s3: 0 };
  const uploadUrl = () =>
    `${new URL(page.url()).origin}/qa-bench-s3-stub/${randomUUID()}/qr?X-Amz-Signature=stub`;
  await page.route(/amazonaws\.com/, (route) => {
    calls.s3 += 1;
    return route.abort();
  });
  await page.route('**/qa-bench-s3-stub/**', (route) => {
    calls.upload += 1;
    return route.fulfill({ status: 200, body: '' });
  });
  await page.route(
    (url) => /\/aws\/katchup\/generate-presigned-url/.test(url.pathname),
    (route) => {
      calls.presign += 1;
      return answers.katchupPresign
        ? answers.katchupPresign(route, calls.presign)
        : route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ presignedURL: uploadUrl() }),
          });
    },
  );
  await page.route(
    (url) => /\/aws\/generate-presigned-url/.test(url.pathname),
    (route) => {
      calls.presign += 1;
      return answers.kmailPresign
        ? answers.kmailPresign(route, calls.presign)
        : route.fulfill({ status: 200, contentType: 'text/plain', body: uploadUrl() });
    },
  );
  await page.route(
    (url) => /\/katchup\/sendMessage\/?$/.test(url.pathname),
    (route) => {
      calls.send += 1;
      return answers.send ? answers.send(route, calls.send) : route.fulfill(failure());
    },
  );
  await page.route(
    (url) => /\/sentMail\/postMail\/?$/.test(url.pathname),
    (route) => {
      calls.mail += 1;
      return answers.mail ? answers.mail(route, calls.mail) : route.fulfill(failure());
    },
  );
  return calls;
}

/** Card › QR › Share QR › Katchup or KMail → "Forward To", with `count` made-up recipients ticked. */
async function shareQrTo(page: Page, card: Locator, channel: 'Katchup' | 'KMail', count: number) {
  await card.locator('button.dc-qr-trigger').first().click();
  await page
    .locator('button.dc-qr-mini-btn')
    .filter({ hasText: /Share QR/i })
    .first()
    .click();
  await page
    .locator(channel === 'Katchup' ? 'span.icon-KP_04-Katchup' : 'span.icon-KP_03-KMail')
    .last()
    .click({ timeout: 10_000 });
  const picker = page
    .getByRole('dialog')
    .filter({ hasText: /Forward To/i })
    .last();
  await expect(picker, 'the recipient picker opens').toBeVisible({ timeout: 10_000 });
  await picker.getByRole('searchbox').first().fill(RECIPIENT);
  const boxes = picker.locator('input[type="checkbox"][name^="Contact "]');
  await expect
    .poll(() => boxes.count(), { message: 'the made-up recipients are listed', timeout: 15_000 })
    .toBeGreaterThanOrEqual(count);
  for (let i = 0; i < count; i += 1) await boxes.nth(i).check();
  await picker.locator('button.post_button_size').last().click();
}

test.describe(
  'KPost Contacts · a Digital Card action the server refuses is reported',
  {
    tag: ['@ui', '@contacts', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test.describe.configure({ timeout: 120_000 });
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real QA account (QA_KPOST_ID)',
    );
    test.skip(!testData.victimKpostId, 'needs the 2nd QA account (QA_VICTIM_KPOST_ID)');

    test('a block the server refuses is reported', async ({ page }) => {
      let refused = 0;
      await page.route('**/contacts/blockOrUnBlockContact/**', (route) => {
        refused += 1;
        return route.fulfill(failure());
      });
      await seedCardBlocked(page, false);
      const card = await openDigitalCard(page, VICTIM_NAME);
      await card.getByRole('button', { name: 'Block Contact', exact: true }).click();
      const confirm = page
        .getByRole('dialog')
        .filter({ hasText: /Are you sure to Block/i })
        .last();
      await expect(confirm, 'the block confirmation opens').toBeVisible({ timeout: 10_000 });
      await confirm.getByRole('button', { name: /^Block$/ }).click();
      await expect(toast(page, 'Some Error Occurred!'), 'the user is told').toBeVisible({
        timeout: 10_000,
      });
      expect(refused, 'the block was answered in the browser').toBeGreaterThanOrEqual(1);
    });

    test('an unblock the server refuses is reported', async ({ page }) => {
      let refused = 0;
      await page.route('**/contacts/blockOrUnBlockContact/**', (route) => {
        refused += 1;
        return route.fulfill(failure());
      });
      // The card is answered as blocked, so it offers Unblock (the account is not blocked for real).
      await seedCardBlocked(page, true);
      const card = await openDigitalCard(page, VICTIM_NAME);
      await card.getByRole('button', { name: 'Unblock Contact', exact: true }).click();
      await expect(
        toast(page, 'Failed to update the contact. Please try again.'),
        'the user is told the contact was not updated',
      ).toBeVisible({ timeout: 10_000 });
      expect(refused, 'the unblock was answered in the browser').toBeGreaterThanOrEqual(1);
    });

    test('a contact deletion the server refuses is reported', async ({ page }) => {
      let refused = 0;
      await page.route(
        (url) => /\/contacts\/deleteContact\/?$/.test(url.pathname),
        (route) => {
          refused += 1;
          return route.fulfill(failure());
        },
      );
      const card = await openDigitalCard(page, VICTIM_NAME);
      await card.getByRole('button', { name: 'Delete Contact', exact: true }).click();
      const confirm = page
        .getByRole('dialog')
        .filter({ hasText: /from your KPOST contacts/i })
        .last();
      await expect(confirm, 'the delete confirmation opens').toBeVisible({ timeout: 10_000 });
      await confirm.getByRole('button', { name: /^Confirm$/ }).click();
      await expect(toast(page, 'Some Error Occured!'), 'the user is told').toBeVisible({
        timeout: 10_000,
      });
      expect(refused, 'the deletion was answered in the browser').toBeGreaterThanOrEqual(1);
    });

    test('a profile photo that cannot be loaded is reported', async ({ page }) => {
      // The card loads normally (its photo button is enabled once the small photo loads). Then both
      // sizes fail: the popup's full-size <img> and its small-photo fallback (an authenticated
      // fetch, so routing reaches it rather than the image cache).
      const mine = (url: string) => decodeURIComponent(url).includes(testData.victimKpostId);
      const card = await openDigitalCard(page, VICTIM_NAME);
      const photo = card.getByRole('button', { name: 'View Profile Photo' });
      await expect(photo, 'the card has a photo to open').toBeEnabled({ timeout: 15_000 });
      const failed: string[] = [];
      await page.route(/\/profile\/download(Full)?ProfileImage\//, (route) => {
        if (!mine(route.request().url())) return route.fallback();
        failed.push(/downloadFull/.test(route.request().url()) ? 'full' : 'small');
        return route.abort();
      });
      await photo.click();
      await expect(toast(page, 'Unable to load image'), 'the user is told').toBeVisible({
        timeout: 15_000,
      });
      expect(failed, 'the full-size photo and its fallback were both asked for').toEqual(
        expect.arrayContaining(['full', 'small']),
      );
    });

    test('a QR share whose every Katchup send is refused is reported', async ({ page }) => {
      await seedRecipients(page);
      const calls = await stubQrShare(page, {});
      const card = await openDigitalCard(page, VICTIM_NAME);
      await shareQrTo(page, card, 'Katchup', 1);
      await expect(
        toast(page, 'Failed to share QR Code in Katchup'),
        'the user is told nothing was shared',
      ).toBeVisible({ timeout: 15_000 });
      expect(calls.send, 'the send was answered in the browser').toBeGreaterThanOrEqual(1);
      expect(calls.s3, 'nothing reached S3').toBe(0);
    });

    test('a QR share to Katchup whose upload URL is refused is reported', async ({ page }) => {
      await seedRecipients(page);
      const calls = await stubQrShare(page, {
        katchupPresign: (route) => route.fulfill(failure(500)),
      });
      const card = await openDigitalCard(page, VICTIM_NAME);
      await shareQrTo(page, card, 'Katchup', 1);
      await expect(
        toast(page, 'Unable to share QR Code in Katchup'),
        'the user is told the QR could not be shared',
      ).toBeVisible({ timeout: 15_000 });
      expect(calls.send, 'no message was sent').toBe(0);
      expect(calls.upload + calls.s3, 'nothing was uploaded').toBe(0);
    });

    test('a QR share whose every KMail send is refused is reported', async ({ page }) => {
      await seedRecipients(page);
      const calls = await stubQrShare(page, {});
      const card = await openDigitalCard(page, VICTIM_NAME);
      await shareQrTo(page, card, 'KMail', 1);
      await expect(
        toast(page, 'Failed to share QR Code in KMail'),
        'the user is told nothing was shared',
      ).toBeVisible({ timeout: 15_000 });
      expect(calls.mail, 'the mail was answered in the browser').toBeGreaterThanOrEqual(1);
      expect(calls.s3, 'nothing reached S3').toBe(0);
    });

    test('a QR share to KMail whose upload URL is refused is reported', async ({ page }) => {
      await seedRecipients(page);
      const calls = await stubQrShare(page, {
        kmailPresign: (route) => route.fulfill(failure(500)),
      });
      const card = await openDigitalCard(page, VICTIM_NAME);
      await shareQrTo(page, card, 'KMail', 1);
      await expect(
        toast(page, 'Unable to share QR Code in KMail'),
        'the user is told the QR could not be shared',
      ).toBeVisible({ timeout: 15_000 });
      expect(calls.mail, 'no mail was sent').toBe(0);
      expect(calls.upload + calls.s3, 'nothing was uploaded').toBe(0);
    });

    test('a QR share that reaches only some recipients is reported', async ({ page }) => {
      await seedRecipients(page);
      // Two recipients: the first send is answered as delivered, the second as refused.
      const calls = await stubQrShare(page, {
        send: (route, call) => route.fulfill(call === 1 ? success({ msgID: 0 }) : failure()),
      });
      const card = await openDigitalCard(page, VICTIM_NAME);
      await shareQrTo(page, card, 'Katchup', 2);
      await expect(
        toast(page, 'QR shared to some recipients. Please retry failed ones.'),
        'the user is told which recipients to retry',
      ).toBeVisible({ timeout: 15_000 });
      expect(calls.send, 'both sends were answered in the browser').toBe(2);
      expect(calls.s3, 'nothing reached S3').toBe(0);
    });
  },
);

test.describe(
  'KPost Contacts · inviting a mobile contact with no e-mail by Gmail is refused',
  {
    tag: ['@ui', '@contacts', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real QA account (QA_KPOST_ID)',
    );

    test('Invite › Gmail for a phone contact without an e-mail says so', async ({ page }) => {
      // Phone contacts are loaded only at login (Login.js FetchMobileContact) and kept in the
      // persisted store, so the made-up one is put into this page's store, never on the server.
      let invited = 0;
      await page.route('**/contacts/updateInviteStatus**', (route) => {
        invited += 1;
        return route.abort();
      });
      expect(await gotoContacts(page), 'the Contacts tab opens').toBe(true);
      const seeded = await page.evaluate(
        (contact) => {
          type Fiber = {
            child?: Fiber;
            sibling?: Fiber;
            memoizedProps?: { store?: { dispatch?: (a: unknown) => void } };
          };
          const root = document.getElementById('root') as unknown as Record<string, Fiber> | null;
          const key = root && Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
          const stack: Fiber[] = key && root ? [root[key]!] : [];
          while (stack.length) {
            const fiber = stack.pop()!;
            const store = fiber.memoizedProps?.store;
            if (typeof store?.dispatch === 'function') {
              // CONTACTS keeps every list it is not given (ensureArray falls back to the state).
              store.dispatch({ type: 'CONTACTS', mobileContact: [contact] });
              return true;
            }
            if (fiber.sibling) stack.push(fiber.sibling);
            if (fiber.child) stack.push(fiber.child);
          }
          return false;
        },
        {
          name: 'QA Bench Invitee',
          mobileNumber: '9000000001',
          email: '',
          inviteStatus: 'N',
        },
      );
      expect(seeded, 'the made-up phone contact is in the page').toBe(true);

      await page.locator('.icon-KP_144---More-Vertical').filter({ visible: true }).last().click();
      await page
        .getByText('Invite Contacts', { exact: true })
        .filter({ visible: true })
        .first()
        .click();
      await page
        .getByText('Mobile Contacts', { exact: true })
        .filter({ visible: true })
        .first()
        .click();
      const list = page
        .getByRole('dialog')
        .filter({ hasText: /Invite Contacts/i })
        .last();
      await expect(list, 'the phone contacts open').toBeVisible({ timeout: 10_000 });
      // The made-up contact is the only phone contact in the page, so its Invite is the only one.
      await expect(
        list.getByText('QA Bench Invitee'),
        'the made-up contact is listed',
      ).toBeVisible();
      await list.getByRole('button', { name: 'Invite', exact: true }).first().click();
      const apps = page
        .getByRole('dialog')
        .filter({ hasText: /Invite Contact/i })
        .filter({ hasText: 'Gmail' })
        .last();
      await apps.getByText('Gmail', { exact: true }).click();
      await expect(
        toast(page, 'Gmail ID is not available for this contact'),
        'the user is told the contact has no Gmail',
      ).toBeVisible({ timeout: 10_000 });
      expect(invited, 'no invite status was recorded').toBe(0);
    });
  },
);
