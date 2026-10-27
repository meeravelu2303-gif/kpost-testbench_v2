import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { STORAGE_STATE_2 } from '@config/constants';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import type { Browser, Locator, Page } from '@playwright/test';
import { openGroupConversation } from '../support/katchup';
import { signedIn } from '@fixtures/login-gate';
import { retryOrSkip } from '../../support/live-condition';

/**
 * Group exit by role: a plain member can exit and the app stays usable (known defect #1368: the
 * screen crashes after exit); no admin is offered "Exit Group". qatest1 creates and removes the
 * group via the API; qatest2 (STORAGE_STATE_2) drives the screen.
 */
const K = AUTH_PROFILES.kpost.principals;
const A = K.find((p) => p.key === 'personal')!;
const B = K.find((p) => p.key === 'victim')!;

type Row = { id: number; kpostID: string; hasAdminAccess?: string; removedFlag?: boolean };

const member = (kpostID: string, isAdmin = false): Record<string, unknown> => ({
  createdBy: A.username,
  hasAdminAccess: isAdmin ? 'Y' : 'N',
  kpostID,
  name: 'QA Bench',
  memberDesignation: '',
  privacyStatus: 'Y',
  remarks: 'created',
});

async function call(
  endpoints: EndpointExecutor,
  who: Principal,
  id: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const ex = await endpoints.sendTo(
    id,
    { body },
    { label: `group-exit:${id}`, auth: { principal: who }, allowLiveWrite: true },
  );
  const parsed = ex.json();
  return {
    status: ex.status,
    data: ((parsed.ok ? (parsed.value as { data?: unknown }).data : {}) ?? {}) as Record<
      string,
      unknown
    >,
  };
}

async function rows(endpoints: EndpointExecutor, groupKpostID: string): Promise<Row[]> {
  const ex = await endpoints.sendTo(
    'group-details-by-id',
    { pathParams: { groupKpostID } },
    { label: 'group-exit:details', auth: { principal: A }, allowLiveRead: true },
  );
  const parsed = ex.json();
  const group = ((parsed.ok
    ? (parsed.value as { known_group?: Record<string, unknown> }).known_group
    : undefined) ?? {}) as { memberDetails?: Row[] };
  return group.memberDetails ?? [];
}

/** Opens Group Info › ⋮ as the 2nd account and returns the options sheet. */
async function openOptions(page: Page, groupKpostID: string): Promise<Locator> {
  const opened = await openGroupConversation(page, groupKpostID);
  retryOrSkip(!opened, 'the new group was not listed in Katchup right now — a list condition');
  await page.locator('#ChatTop .background-color-katchup .line_height').first().click();
  const panel = page.locator('#ChatTop .comm_back').first();
  await expect(panel.getByText(/Katchup Group Info/i), 'Group Info opens').toBeVisible({
    timeout: 15_000,
  });
  await panel.locator('.icon-KP_144---More-Vertical').first().click();
  const menu = panel.locator('.back_three_color').first();
  await expect(menu, 'the options sheet opens').toBeVisible({ timeout: 10_000 });
  return menu;
}

test.describe(
  'KPost Groups · exit by role through the screen (FR-GM-014 / FR-GM-015) @ui',
  { tag: ['@ui', '@group', '@regression'] },
  () => {
    test.describe.configure({ timeout: 180_000 });
    test.skip(
      process.env.GROUP_UI_LIFECYCLE !== 'true',
      'creates real groups; set GROUP_UI_LIFECYCLE=true',
    );
    test.skip(
      process.env.KATCHUP_UI_LIFECYCLE !== 'true',
      'needs auth2.setup.ts to log the 2nd account in; set KATCHUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts',
    );

    async function withGroup(
      browser: Browser,
      endpoints: EndpointExecutor,
      label: string,
      body: (page: Page, group: { groupID: number; groupKpostID: string }) => Promise<void>,
    ): Promise<void> {
      const created = await call(endpoints, A, 'group-create', {
        activeStatus: 'Y',
        createdBy: A.username,
        groupPicturePath: null,
        groupCreateAccess: true,
        groupKpostName: `QA UI ${label} ${Date.now()}`,
        isPrivateGroup: 'N',
        memberDetails: [member(B.username), member(A.username, true)],
      });
      const groupID = created.data.groupID as number;
      const groupKpostID = created.data.groupKpostID as string;
      expect(groupID && groupKpostID, 'qatest1 creates the group').toBeTruthy();
      const context = await browser.newContext({ storageState: signedIn(STORAGE_STATE_2) });
      try {
        await body(await context.newPage(), { groupID, groupKpostID });
      } finally {
        await context.close();
        const left = (await rows(endpoints, groupKpostID).catch(() => []))
          .filter((m) => m.removedFlag !== true && m.kpostID !== A.username)
          .map((m) => m.kpostID);
        if (left.length)
          await call(endpoints, A, 'group-remove-member', {
            memberKpostIdList: left,
            groupKpostID,
            groupID,
          }).catch(() => undefined);
        const deleted = await call(endpoints, A, 'group-delete', { groupID, groupKpostID }).catch(
          () => ({ status: 0, data: {} }),
        );
        expect.soft(deleted.status, 'the test group is deleted (nothing left behind)').toBe(200);
      }
    }

    test(
      'a plain member is offered only Exit Group, leaves, and the app stays usable (#1368) @ui',
      { annotation: [{ type: 'requirement', description: 'FR-GM-015' }] },
      async ({ browser, endpoints }) => {
        await withGroup(browser, endpoints, 'Member Exit', async (page, group) => {
          const crashes: string[] = [];
          page.on('console', (m) => {
            if (m.type() === 'error' && /rendering failed|TypeError/.test(m.text()))
              crashes.push(m.text().slice(0, 200));
          });
          const menu = await openOptions(page, group.groupKpostID);
          const items = (await menu.innerText())
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
          expect(items, 'a plain member is offered only "Exit Group"').toEqual(['Exit Group']);

          await menu.getByText('Exit Group', { exact: true }).click();
          const confirm = page.getByRole('button', { name: /^Confirm$/ }).last();
          await expect(confirm, 'the exit confirmation opens').toBeVisible({ timeout: 10_000 });
          const leave = page.waitForResponse((r) => r.url().includes('leaveFromGroup'), {
            timeout: 20_000,
          });
          await confirm.click();
          expect((await leave).status(), 'the exit is accepted').toBe(200);
          const me = (await rows(endpoints, group.groupKpostID)).find(
            (m) => m.kpostID === B.username,
          );
          expect(me?.removedFlag, 'qatest2 is no longer a member').toBe(true);

          await expect(
            page.getByText('Something went wrong'),
            `after leaving, the app must not crash (#1368: ${crashes[0] ?? 'no console error'})`,
          ).toHaveCount(0, { timeout: 8_000 });
        });
      },
    );

    test(
      'a promoted co-admin is not offered Exit Group — admins cannot exit (#1367) @ui',
      { annotation: [{ type: 'requirement', description: 'FR-GM-014' }] },
      async ({ browser, endpoints }) => {
        await withGroup(browser, endpoints, 'Coadmin Exit', async (page, group) => {
          const bRow = (await rows(endpoints, group.groupKpostID)).find(
            (m) => m.kpostID === B.username,
          );
          const promote = await call(endpoints, A, 'group-admin-access', {
            kpostIDs: [B.username],
            ids: [bRow?.id ?? 0],
            groupID: group.groupID,
            hasAdminAccess: 'Y',
          });
          expect(promote.status, 'qatest2 is promoted to co-admin').toBeLessThan(300);

          const menu = await openOptions(page, group.groupKpostID);
          await expect(
            menu.getByText('Remove Members', { exact: true }),
            'the co-admin gets the admin actions (control)',
          ).toBeVisible();
          await expect(
            menu.getByText('Exit Group', { exact: true }),
            'an admin must not be offered Exit Group — admins remove members, only members exit (#1367)',
          ).toHaveCount(0);
        });
      },
    );
  },
);
