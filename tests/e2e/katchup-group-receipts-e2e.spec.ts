import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { STORAGE_STATE_2, STORAGE_STATE_3 } from '@config/constants';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import type { Browser, Page } from '@playwright/test';
import { gotoKatchup } from './support/katchup';

/**
 * A brand-new group with no messages yet doesn't appear in the default "Recents" tab (which lists by
 * recent message activity) — it only shows under the "Contacts" tab's "Groups" section until the first
 * message exists. `openComposerFor` (built for an already-active 1:1/group conversation) assumes
 * Recents, so this test needs its own opener for a freshly-created group specifically.
 */
async function openNewGroupConversation(page: Page, groupKpostID: string): Promise<void> {
  const groupRow = page.locator(`[id="${groupKpostID}"]`).first();
  // A group created moments ago via the API may not appear on the first load — retry with a fresh
  // reload rather than assume the selector is wrong (the group's own name wasn't found anywhere on the
  // page either on the first attempt, ruling out a selector mismatch).
  for (let attempt = 1; attempt <= 4; attempt++) {
    await gotoKatchup(page);
    await page.getByRole('tab', { name: 'Contacts' }).click();
    const found = await groupRow
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (found) {
      await groupRow.click();
      return;
    }
  }
  await groupRow.waitFor({ state: 'visible', timeout: 10_000 });
  await groupRow.click();
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
  { tag: '@ui' },
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
    }) => {
      // NOT YET COMPLETED — root cause found (2026-10-04), not a selector problem. The group IS created
      // successfully every time (a real groupKpostID comes back), and the group's name genuinely never
      // appears anywhere on the page afterward — but this isn't a DOM-id mismatch. A dedicated diagnostic
      // (logging every network response during `openNewGroupConversation`'s own reload-retry loop) caught
      // the real cause: the Contacts tab's own group-list fetch (`POST /v2/contacts/myGroups/`, the exact
      // call that populates this section — confirmed from source as `GetMyGroup`, called app-wide from
      // `App.js`/`MenuRoutes.js`) returned a clean 401 "UNAUTHORIZED USER" on every one of 4 attempts in
      // this browser session — while the SAME account's SAME endpoint, called with a freshly-minted token
      // via `endpoints.sendTo('contacts-my-groups', ...)`, returns a clean 200 with real group data. The
      // persisted UI session (`.auth/user.json`, reused across many tests in one long run) can apparently
      // go stale for specific calls in a way a fresh token does not — the Groups section has nothing to
      // show because its own data fetch is being rejected, not because the group is missing or the
      // selector is wrong. This is the same class of 401-handling fragility already filed as **#979**
      // (a non-"expired" 401 on a real session should either refresh or cleanly force a visible logout —
      // here it does neither, just silently leaves the UI with no data). Not filing a second ticket for
      // what is very likely the same root cause; blocked on #979's fix.
      test.fixme(
        true,
        "blocked by #979-class session fragility — the Contacts tab's own myGroups fetch 401s on this browser session while a fresh token for the same account succeeds, so the group list has no data to show; see the comment above",
      );
      let groupKpostID: string | undefined;
      let groupID: number | undefined;

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
          // Self-leave for each member (the admin-remove endpoint is a known intermittent 500 —
          // self-leave is the reliable cleanup path established earlier this session), then delete.
          await as(
            endpoints,
            MEMBER_2,
            'group-leave',
            { id: '0', groupID, groupKpostID },
            'cleanup-leave-m2',
          ).catch(() => undefined);
          await as(
            endpoints,
            MEMBER_3,
            'group-leave',
            { id: '0', groupID, groupKpostID },
            'cleanup-leave-m3',
          ).catch(() => undefined);
          await as(endpoints, ADMIN, 'group-delete', { groupKpostID }, 'cleanup-delete').catch(
            () => undefined,
          );
        }
      }
    });
  },
);
