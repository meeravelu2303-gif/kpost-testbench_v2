import type { Route } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { setupStep } from '@ui/setup-step';
import { retryOrSkip } from '../../support/live-condition';
import { waitLoaded } from '../journeys/support/journey';
import { createQaGroup, deleteQaGroup, GROUP_CREATOR, type QaGroup } from '../support/groups';
import { openReceivedMail } from '../support/kmail';
import { toast } from '../support/validation';

/**
 * KMail threads and contacts: when the server refuses or does not answer, the screen says so. One
 * call is failed in the browser per test, with the shape the component reacts to (read from
 * Services/Kmail.js, Services/Katchup.js and the component):
 * - KmailMessage.js getMailWithContent: /readMail/sentAndInboxMailContent fails → Translate;
 * - MailFooter.js FrwdMail: the content comes back empty → Forward → send;
 * - WriteMailBox.js PostMail: a reply the server refuses;
 * - KmailMessage.js handleGroupNameEdit: /group/editGroupName refused (a group made for the test);
 * - AddOtherDomain.js: /common/addOtherDomainContacts refused (an outside address seeded in the
 *   browser).
 * Every mail, draft and group write is answered in the browser, so nothing is sent or changed; the
 * only real write is the throwaway group, deleted afterwards.
 */
const POST_MAIL = '**/sentMail/postMail**';
const DRAFT_MAIL = '**/draft/draftMail**';
const MAIL_CONTENT = '**/readMail/sentAndInboxMailContent**';
const GROUP_WRITES =
  /\/group\/(editGroupName|addOrRemoveAdminAccess|addUserToGroup|removeGroupMember|leaveFromGroup)/;

const json = (body: object) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});
const failure = () => json({ status: 'FAILURE', statusCode: 400, message: '' });

test.describe(
  'KPost KMail · a thread or contact action the server refuses is reported',
  {
    tag: ['@ui', '@kmail', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real QA account (QA_KPOST_ID)',
    );

    let posted = 0;

    test.beforeEach(async ({ page }) => {
      posted = 0;
      // No mail or draft may leave the browser; a test that answers one registers later, so it wins.
      const block = (route: Route) => {
        posted += 1;
        return route.abort();
      };
      await page.route(POST_MAIL, block);
      await page.route(DRAFT_MAIL, block);
    });

    test.describe('in the conversation with the 2nd QA account', () => {
      test.skip(
        !testData.victimKpostId || testData.victimKpostId.includes('qa.victim'),
        'needs the 2nd QA account (QA_VICTIM_KPOST_ID)',
      );

      test('Translate on a mail whose content cannot be loaded is reported', async ({ page }) => {
        let asked = 0;
        await page.route(MAIL_CONTENT, (route) => {
          asked += 1;
          return route.fulfill(failure());
        });
        const box = await openReceivedMail(page);
        const before = asked;
        await box.locator('.icon-KP_75-translate').first().click();
        await expect(
          toast(page, 'Unable to load mail content. Please try again.'),
          'the user is told the mail could not be loaded',
        ).toBeVisible({ timeout: 10_000 });
        expect(asked, 'Translate asked for the mail content').toBeGreaterThan(before);
      });

      test('Forward of a mail whose content comes back empty is reported, and nothing is sent', async ({
        page,
      }) => {
        let asked = 0;
        // The read succeeds but carries no content (MailFooter.js FrwdMail checks mailContent).
        await page.route(MAIL_CONTENT, async (route) => {
          asked += 1;
          const real = await route.fetch().catch(() => null);
          const body = ((await real?.json().catch(() => null)) ?? {}) as {
            data?: Record<string, unknown>;
          };
          const data =
            body.data && typeof body.data === 'object' && !Array.isArray(body.data)
              ? body.data
              : { referenceKmail: [], attachmentName: [], originalMailContent: '' };
          return route.fulfill(
            json({
              ...body,
              status: 'SUCCESS',
              statusCode: 200,
              data: { ...data, mailContent: '' },
            }),
          );
        });
        const box = await openReceivedMail(page);
        // Reply arrow → More → Forward.
        await box.getByTestId('ReplyIcon').first().click();
        const menu = page.locator('[role="menu"]');
        await menu.getByText('More', { exact: true }).first().click();
        await menu.getByText('Forward', { exact: true }).first().click();
        // The forward footer's "Forward To" opens the recipient picker; anyone will do.
        await page.getByText('Forward To', { exact: true }).first().click({ timeout: 15_000 });
        const picker = page.getByRole('dialog').last();
        const pick = picker.getByRole('checkbox').first();
        await expect(pick, setupStep('the Forward To picker lists contacts')).toBeVisible({
          timeout: 15_000,
        });
        await pick.check();
        await picker.getByRole('button', { name: /^Done$/i }).click();
        const before = asked;
        await page
          .locator('.post_button_size')
          .filter({ has: page.locator('.icon-KP_3164') })
          .last()
          .click();
        await expect(
          toast(page, 'Unable to load mail content. Please try again.'),
          'the user is told the mail could not be loaded',
        ).toBeVisible({ timeout: 10_000 });
        expect(asked, 'the forward asked for the mail content').toBeGreaterThan(before);
        expect(posted, 'a forward with no content is never sent').toBe(0);
      });

      test('a reply the server refuses is reported', async ({ page }) => {
        await page.route(POST_MAIL, (route) => {
          posted += 1;
          return route.fulfill(
            json({
              status: 'FAILURE',
              statusCode: 500,
              message: '',
              data: [{ mailDeliveryStatus: 'FAILURE' }],
            }),
          );
        });
        const box = await openReceivedMail(page);
        await box.getByTestId('ReplyIcon').first().click();
        await page.locator('[role="menu"]').getByText('Reply', { exact: true }).first().click();
        const editor = page.locator('.ql-editor[contenteditable="true"]').last();
        await expect(editor, setupStep('the reply composer opens')).toBeVisible({
          timeout: 15_000,
        });
        await editor.click();
        await page.keyboard.type('QA bench reply (answered in the browser, never sent)');
        await page
          .locator('.post_button_size')
          .filter({ has: page.locator('.icon-KP_3164') })
          .last()
          .click();
        await expect(toast(page, 'Some Error Occured!'), 'the user is told').toBeVisible({
          timeout: 10_000,
        });
        expect(posted, 'the reply was answered in the browser').toBe(1);
      });
    });

    test('a group rename the server refuses is reported (group made for the test, deleted after)', async ({
      page,
      endpoints,
    }) => {
      test.skip(
        process.env.GROUP_UI_LIFECYCLE !== 'true',
        'creates and deletes a real group; set GROUP_UI_LIFECYCLE=true',
      );
      test.skip(
        !GROUP_CREATOR || !testData.personal3KpostId || testData.personal3KpostId.includes('qa.p3'),
        'needs the 3rd QA account (QA_PERSONAL_3_KPOST_ID) to create the group',
      );
      // Up to three loads of /kmail for the new group to reach the contact list.
      test.setTimeout(180_000);
      let renames = 0;
      await page.route(GROUP_WRITES, (route) => {
        if (route.request().url().includes('/group/editGroupName')) renames += 1;
        return route.fulfill(failure());
      });
      const stamp = Date.now();
      let group: QaGroup | undefined;
      try {
        // Created by personal-3; the browser's account is an admin (Edit Group is admin-only).
        group = await createQaGroup(endpoints, `kmail-grp-${stamp}`, {
          admins: [testData.kpostId],
        });
        const name = new RegExp(`QA UI kmail-grp-${stamp}`);
        const row = page.getByText(name).filter({ visible: true }).first();
        let listed = false;
        for (let attempt = 1; attempt <= 3 && !listed; attempt++) {
          await page.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
          await waitLoaded(page);
          await page.getByRole('tab', { name: 'Contacts' }).first().click({ timeout: 15_000 });
          listed = await row
            .waitFor({ state: 'visible', timeout: 15_000 })
            .then(() => true)
            .catch(() => false);
        }
        retryOrSkip(
          !listed,
          'the new group was not listed in KMail Contacts right now (three loads)',
        );
        await row.click();

        // The thread header's name column opens Kmail Group Info.
        await page
          .locator('.background-color-katchup .line_height')
          .filter({ hasText: name })
          .filter({ visible: true })
          .first()
          .click({ timeout: 20_000 });
        const panel = page.locator('.comm_back').filter({ hasText: 'Kmail Group Info' }).first();
        await expect(panel, setupStep('Kmail Group Info opens')).toBeVisible({ timeout: 15_000 });
        await panel.locator('.icon-KP_144---More-Vertical').first().click();
        await page
          .locator('.back_three_color')
          .getByText('Edit Group', { exact: true })
          .first()
          .click();
        const dialog = page.getByRole('dialog').filter({ hasText: 'Edit Group' }).last();
        await expect(dialog, setupStep('the Edit Group dialog opens')).toBeVisible({
          timeout: 10_000,
        });
        // Letters, digits and spaces only (the field drops anything else).
        await dialog.locator('input:not([type="file"])').first().fill(`QA Renamed ${stamp}`);
        await dialog.getByRole('button', { name: /^Change$/ }).click();
        await expect(toast(page, 'Some Error Occured!'), 'the user is told').toBeVisible({
          timeout: 10_000,
        });
        expect(renames, 'the rename was answered in the browser').toBe(1);
      } finally {
        await deleteQaGroup(endpoints, group);
      }
    });

    test('adding an outside address as a contact that the server refuses is reported', async ({
      page,
    }) => {
      const outside = `qa-bench-outside-${Date.now()}@example.com`;
      // The unknown outside address is seeded in the browser; the add is answered there too.
      await page.route('**/common/miscellaneousContacts**', (route) =>
        route.fulfill(json({ status: 'SUCCESS', statusCode: 200, value: [outside] })),
      );
      let adds = 0;
      await page.route('**/common/addOtherDomainContacts**', (route) => {
        adds += 1;
        return route.fulfill(failure());
      });
      await page.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await waitLoaded(page);
      await page.getByRole('tab', { name: 'Contacts' }).first().click({ timeout: 15_000 });
      const section = page
        .locator('[data-type="Unknown Other Domain Contact"]')
        .filter({ visible: true })
        .first();
      await expect(
        section.getByText(outside).first(),
        setupStep('the seeded outside address is listed'),
      ).toBeVisible({ timeout: 20_000 });
      await section.getByText('Add Contact').first().click();
      const dialog = page.getByRole('dialog').filter({ hasText: 'Add To Contact' }).last();
      await expect(dialog, setupStep('the Add To Contact dialog opens')).toBeVisible({
        timeout: 10_000,
      });
      await dialog.getByPlaceholder('Enter the Contact Name').fill('QA Bench Outside');
      await dialog.getByPlaceholder('Add Reference').fill('QA bench');
      await dialog.getByRole('button', { name: /^Save$/ }).click();
      await expect(toast(page, 'Some Thing Went wrong!'), 'the user is told').toBeVisible({
        timeout: 10_000,
      });
      expect(adds, 'the add was answered in the browser').toBe(1);
    });
  },
);
