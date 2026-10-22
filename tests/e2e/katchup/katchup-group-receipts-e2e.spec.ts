import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { STORAGE_STATE_2, STORAGE_STATE_3 } from '@config/constants';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import type { Browser, Page } from '@playwright/test';
import { openGroupConversation } from './support/katchup';

/**
 * Open a freshly created group's conversation. Updated 2026-10-14: the old opener clicked a "Contacts"
 * tab on /katchup that no longer exists on the live page (the run timed out waiting for it). The shared
 * `openGroupConversation` helper is the live-measured path: creating a group posts the "<creator> added
 * <members>" activity message, which gives it a Recents row keyed by its groupKpostID, and the helper
 * reloads up to 4 times for a group created moments ago through the API.
 */
async function openNewGroupConversation(page: Page, groupKpostID: string): Promise<void> {
  const opened = await openGroupConversation(page, groupKpostID);
  expect(opened, `the new group ${groupKpostID} appears in Katchup Recents and opens`).toBe(true);
}

async function openNewGroupComposer(page: Page, groupKpostID: string): Promise<void> {
  await openNewGroupConversation(page, groupKpostID);
  await page.locator('.msg-arrow').first().click();
}

/**
 * Group send + per-recipient read receipts (FR-K06/FR-K07) — a documented coverage gap
 * ("the 3-account harness exists; group SEND + per-recipient receipts is the remaining multi-account
 * flow to record" in src/ui/katchup-features.ts).
 *
 * The group is created via the API (the existing UI create-group flow, `group.spec.ts`, is its own
 * documented "best-effort, needs a recording pass" first draft — not a reliable foundation to build a
 * receipts test on top of). Everything AFTER creation — sending and reading the group message, and the
 * per-member "Read By" panel — is driven through the real UI.
 *
 * Read directly from source (bubble/KatchupMessage/KatchupMessage.js): a group message's own `Info`
 * icon (`.icon-KP_35-Info`, only rendered `{selectedContact?.group ? ... : null}`) calls `MessageView
 * (msg)`, which POSTs `getReadStatusGroupMessage` (wrapped as `PostGroupMemberMessage`) and opens a
 * "Read By" panel showing a live count (`receiver.filter(r => r.remarks === "Receiver" && r.readStatus
 * === "Y").length`) plus a `ContactBar` row per member who has actually read it — the real, per-
 * recipient mechanism FR-K07 describes, distinct from the 1:1 read-receipt already covered by
 * `katchup-two-session.spec.ts`.
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
      // ROOT CAUSE CORRECTED 2026-10-14. The 2026-10-04 diagnosis saw the page's myGroups fetch 401 while
      // a freshly-minted API token for the same account got a clean 200, and attributed it to #979. It
      // was not #979: the server allows ONE active session per account, so the API `group-create` below
      // (which logs ADMIN = qatest1 in afresh) invalidates this page's saved `.auth/user.json` session —
      // every UI call after it 401s and the app bounces to /login (reproduced live 2026-10-14: 401 on
      // every endpoint, page at /login, during the admin's composer step). The fix is to re-login the UI
      // AFTER the API setup so the browser holds the newest session.
      //
      // Because of that same single-session rule, this test invalidates qatest1's saved session for
      // anything that runs after it in the same invocation — run it isolated (or last), and re-run
      // `setup` before other qatest1 specs.
      // KNOWN OPEN BUG #1343 [KP-GRPOLDERPAGE500], confirmed live 2026-10-14 (4/4 new groups): opening a
      // group whose history fits on one page makes the UI request the older page past the first message,
      // the server 500s, and the thread breaks so the group message never renders. fixme until #1343 is
      // fixed — then remove this line; the rest of the flow (re-login, shared opener, {groupID} cleanup)
      // is already corrected.
      test.fixme(true, 'blocked by #1343 — group thread older-page request 500s on open');
      let groupKpostID: string | undefined;
      let groupID: number | undefined;

      // Evidence capture: if the UI's thread-load for the group fails, record the exact request body it
      // sent. (Live 2026-10-14: the UI's katchupMessagesForSelectedContactID 500'd on opening a new
      // group, while the same endpoint called with { groupFlag: true, receiver: <groupKpostID> } returns
      // 200 — so the body the UI sends is the thing to look at.)
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

        // The API group-create just minted a new server session for ADMIN, invalidating this page's
        // saved one (single session per account) — re-login the UI so the browser's session is newest.
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

        // Member 3 opens it too — the count must advance independently, proving per-recipient tracking,
        // not a single group-wide read flag.
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
          // The admin removes both members (removeGroupMember's 500 is fixed — #945, re-verified
          // 2026-10-14), then deletes. The old self-leave sent id '0', which now answers 400 "you are
          // not a member" (live 2026-10-15), so it silently left the group behind.
          await as(
            endpoints,
            ADMIN,
            'group-remove-member',
            { memberKpostIdList: [MEMBER_2.username, MEMBER_3.username], groupID, groupKpostID },
            'cleanup-remove-members',
          ).catch(() => undefined);
          // `deleteGroup` takes { groupID } (group.api.ts) — sending { groupKpostID } 404'd and orphaned
          // every QA group. It also 400s until every other member has left, hence the leaves above.
          await as(endpoints, ADMIN, 'group-delete', { groupID }, 'cleanup-delete').catch(
            () => undefined,
          );
        }
      }
    });
  },
);
