import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { STORAGE_STATE_2, STORAGE_STATE_3 } from '@config/constants';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import type { Browser, Page } from '@playwright/test';
import { openGroupConversation } from '../support/katchup';

/** Open a freshly created group's conversation (its Recents row may take a few reloads to appear). */
async function openNewGroupConversation(page: Page, groupKpostID: string): Promise<void> {
  const opened = await openGroupConversation(page, groupKpostID);
  expect(opened, `the new group ${groupKpostID} appears in Katchup Recents and opens`).toBe(true);
}

async function openNewGroupComposer(page: Page, groupKpostID: string): Promise<void> {
  await openNewGroupConversation(page, groupKpostID);
  await page.locator('.msg-arrow').first().click();
}

/**
 * Group message per-member read receipts (the "Read By" panel behind a group message's Info icon),
 * with three accounts. The group is created via the API; sending and reading go through the UI.
 */
const K = AUTH_PROFILES.kpost;
const ADMIN: Principal = K.principals.find((p) => p.key === 'personal')!;
const MEMBER_2: Principal = K.principals.find((p) => p.key === 'victim')!;
const MEMBER_3: Principal = K.principals.find((p) => p.key === 'personal-3')!;

const member = (kpostID: string, isAdmin = false): Record<string, unknown> => ({
  createdBy: ADMIN.username,
  hasAdminAccess: isAdmin ? 'Y' : 'N',
  kpostID,
  name: 'QA Bench',
  memberDesignation: '',
  privacyStatus: 'Y',
  remarks: 'created',
});

async function as(
  endpoints: EndpointExecutor,
  who: Principal,
  id: string,
  bodyObj: Record<string, unknown> | undefined,
  label: string,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const ex = await endpoints.sendTo(id, bodyObj ? { body: bodyObj } : {}, {
    label: `group-receipts:${label}`,
    auth: { principal: who },
    allowLiveWrite: true,
  });
  const parsed = ex.json();
  const value = (parsed.ok ? parsed.value : {}) as Record<string, unknown>;
  return { status: ex.status, data: (value.data as Record<string, unknown>) ?? {} };
}

test.describe(
  'KPost Katchup · Group send + per-recipient read receipts @ui',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
    test.skip(
      process.env.KATCHUP_UI_LIFECYCLE !== 'true',
      'creates a real group and sends a real message; set KATCHUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId ||
        testData.kpostId.includes('qa.bench') ||
        !testData.victimKpostId ||
        !testData.personal3KpostId ||
        testData.personal3KpostId.includes('qa.p3'),
      'needs all three QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID, a configured personal-3 account)',
    );

    async function openMember(browser: Browser, storageState: string) {
      const context = await browser.newContext({ storageState });
      return { context, page: await context.newPage() };
    }

    test('a group message is tracked read independently per member, not as one group-wide flag @ui', async ({
      page,
      browser,
      endpoints,
      loginPage,
    }) => {
      // One session per account: the API login below invalidates the saved UI session, so the UI
      // re-logs in after it. Run this isolated (or last) and re-run `setup` before other qatest1 specs.
      // Known defect #1343: opening a new group 500s on the older-page request, so the thread never renders.
      test.fixme(true, 'blocked by #1343 — group thread older-page request 500s on open');
      let groupKpostID: string | undefined;
      let groupID: number | undefined;

      // If the group thread-load fails, record the exact request body the UI sent.
      page.on('response', (r) => {
        if (r.url().includes('/katchup/katchupMessagesForSelectedContactID') && r.status() >= 500) {
          const sent = r.request().postData() ?? '(no body)';
          console.log(`THREAD-LOAD ${r.status()} request=${sent}`);
          test.info().annotations.push({
            type: 'observed',
            description: `thread-load HTTP ${r.status()}; UI request body: ${sent}`,
          });
        }
      });

      try {
        const created = await as(
          endpoints,
          ADMIN,
          'group-create',
          {
            activeStatus: 'Y',
            createdBy: ADMIN.username,
            groupPicturePath: null,
            groupCreateAccess: true,
            groupKpostName: `QA UI Receipts Group ${Date.now()}`,
            isPrivateGroup: 'N',
            memberDetails: [
              member(ADMIN.username, true),
              member(MEMBER_2.username),
              member(MEMBER_3.username),
            ],
          },
          'create',
        );
        groupKpostID = created.data.groupKpostID as string | undefined;
        groupID = created.data.groupID as number | undefined;
        expect(groupKpostID, 'the group was created with a real groupKpostID').toBeTruthy();
        if (!groupKpostID) return;

        // The API call above invalidated this page's session; log the UI back in.
        await loginPage.goto();
        await loginPage.login(testData.kpostId, testData.password);
        await expect(page, 'the admin UI session is re-established after the API setup').toHaveURL(
          /\/home/,
          { timeout: 20_000 },
        );

        const subject = `QA UI group receipts ${Date.now()}`;
        await openNewGroupComposer(page, groupKpostID);
        await page.getByRole('textbox', { name: 'Subject' }).fill(subject);
        await page.locator('.ql-editor[contenteditable="true"]').first().click();
        await page.keyboard.type('QA UI group receipts — self-cleaning');
        await page.keyboard.press('Enter');

        const sentMessage = page.locator('[id]').filter({ hasText: subject }).last();
        await expect(sentMessage, 'the group message sends').toBeVisible({ timeout: 20_000 });

        const infoIcon = sentMessage.locator('.icon-KP_35-Info').first();
        const openReadByPanel = async () => {
          await infoIcon.click({ force: true });
          const panel = page.getByText('Read By', { exact: true }).first();
          await expect(panel, 'the Read By panel opens').toBeVisible({ timeout: 15_000 });
          return page.locator('.count_back_member_font').first();
        };

        const countBefore = await (await openReadByPanel()).textContent();
        expect(Number(countBefore?.trim() || '0'), 'nobody has read it yet').toBe(0);

        // Member 2 opens the group conversation — marks it read for them specifically.
        const m2 = await openMember(browser, STORAGE_STATE_2);
        await openNewGroupConversation(m2.page, groupKpostID);
        await expect(
          m2.page.getByText(subject).first(),
          'member 2 sees the group message',
        ).toBeVisible({ timeout: 20_000 });
        await m2.context.close();

        const countAfterM2 = await (await openReadByPanel()).textContent();
        expect(
          Number(countAfterM2?.trim() || '0'),
          'exactly one member (not zero, not all) has read it after member 2 alone opens it',
        ).toBe(1);

        // Member 3 opens it too: the count must advance per member, not as one group-wide flag.
        const m3 = await openMember(browser, STORAGE_STATE_3);
        await openNewGroupConversation(m3.page, groupKpostID);
        await expect(
          m3.page.getByText(subject).first(),
          'member 3 sees the group message',
        ).toBeVisible({ timeout: 20_000 });
        await m3.context.close();

        const countAfterM3 = await (await openReadByPanel()).textContent();
        expect(
          Number(countAfterM3?.trim() || '0'),
          'both members now show as having read it independently',
        ).toBe(2);
      } finally {
        if (groupKpostID && groupID) {
          // Remove both members first: deleteGroup 400s while other members remain.
          await as(
            endpoints,
            ADMIN,
            'group-remove-member',
            { memberKpostIdList: [MEMBER_2.username, MEMBER_3.username], groupID, groupKpostID },
            'cleanup-remove-members',
          ).catch(() => undefined);
          // deleteGroup takes { groupID }, not { groupKpostID }.
          await as(endpoints, ADMIN, 'group-delete', { groupID }, 'cleanup-delete').catch(
            () => undefined,
          );
        }
      }
    });
  },
);
