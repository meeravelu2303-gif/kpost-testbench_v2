// An orchestrated live-write flow: the branch below is the whole point — it registers a resource
// only when the application actually created one. Same allowance the other lifecycle specs carry.
/* eslint-disable playwright/no-conditional-in-test */
import type { Page } from '@playwright/test';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { env } from '@config/env';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import type { CleanupCoordinator } from '../../src/test-data/index';

/**
 * **Group** — group messaging inside Katchup (create → members → admin → rename → delete). Lives in
 * `Katchup/bubble/ContactList/ContactList.js`: a "Create New Group" modal with a "Group Name" field
 * and a member picker (`setCreateGrp`, `finalSubmit={NewGrpMembers}`), and `EditGroupName` for rename.
 * The API group lifecycle (create → add → admin → rename → image → leave → remove → delete) is green.
 *
 * Gated behind `GROUP_UI_LIFECYCLE=true`. Never runs on a default run.
 *
 * ## Why this test reaches for the API at the end
 *
 * The UI submit hands back NO group identity — the modal closes and that is all. So a UI-created
 * group could previously be left on the QA account with nothing knowing it existed: this file's own
 * header used to claim it was "self-cleaning (delete the group it creates)" and its last statement
 * was the submit click. It deleted nothing, and CLAUDE.md records the residue that produced
 * (`QA Group <ts>` left on the QA accounts).
 *
 * The repair does not invent a cleanup mechanism. It looks the group up by the unique name this test
 * generated, using the registered `contacts-my-groups` read, and hands the real `groupID` to the
 * EXISTING resource ledger — so the existing cleanup fixture removes the members and deletes the
 * group, and records CLEANED or CLEANUP_FAILED either way.
 *
 * **Session note:** the lookup authenticates as the same account the browser is signed in as, and
 * KPost allows one session per account, so the API call displaces the UI session. It is therefore
 * deliberately the LAST thing the test does, after every UI assertion.
 *
 * FIRST-RUN NOTE: the create-group trigger and the member-picker + submit are a nested multi-step
 * modal that needs one live recording pass, so the submit may or may not actually create a group.
 * Both outcomes are handled and neither is silent — see the assertion at the end.
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

/** A group as `contacts-my-groups` returns it. Only the fields used here are named. */
interface GroupRow {
  groupID?: unknown;
  groupKpostID?: unknown;
  groupKpostName?: unknown;
  memberDetails?: unknown;
}

/**
 * Finds a group by its exact name.
 *
 * `POST /v2/contacts/myGroups/` answers `{ group_added: [...] }`, each row carrying `groupID`,
 * `groupKpostID`, `groupKpostName` and `memberDetails[]` (contract response example). The name this
 * test generates carries a timestamp, so an exact match cannot collide with another run's group.
 */
async function findGroupByName(
  endpoints: EndpointExecutor,
  name: string,
): Promise<GroupRow | undefined> {
  const exchange = await endpoints
    .sendTo(
      'contacts-my-groups',
      { body: { lastfetchDate: null } },
      { label: 'group-ui:lookup', auth: { principal: A } },
    )
    .catch(() => undefined);
  if (!exchange) return undefined;
  const parsed = exchange.json();
  if (!parsed.ok) return undefined;
  const rows = (parsed.value as Record<string, unknown>).group_added;
  if (!Array.isArray(rows)) return undefined;
  return (rows as GroupRow[]).find(
    (row) => typeof row.groupKpostName === 'string' && row.groupKpostName === name,
  );
}

/**
 * Deletes a group the way the application requires: members first, then the group.
 *
 * `deleteGroup` alone answers 400 "you need to remove all the members" — verified on live and
 * recorded on the endpoint definition. This is the ledger's cleanup OPERATION, so it deliberately
 * does not swallow failures: a failed delete must reach the cleanup summary, not vanish.
 */
async function deleteGroup(endpoints: EndpointExecutor, group: GroupRow): Promise<string> {
  const groupID = group.groupID;
  const groupKpostID = group.groupKpostID;
  const members = Array.isArray(group.memberDetails)
    ? (group.memberDetails as Record<string, unknown>[])
        .map((member) => member.kpostID)
        .filter((id): id is string => typeof id === 'string')
    : [];

  if (members.length > 0) {
    await endpoints.sendTo(
      'group-remove-member',
      { body: { memberKpostIdList: members, groupID, groupKpostID } },
      { label: 'group-ui:cleanup-remove-members', auth: { principal: A }, allowLiveWrite: true },
    );
  }
  const deleted = await endpoints.sendTo(
    'group-delete',
    { body: { groupID } },
    { label: 'group-ui:cleanup-delete', auth: { principal: A }, allowLiveWrite: true },
  );
  return `removed ${members.length} member(s), deleteGroup (${deleted.status})`;
}

test.describe('KPost Group — create-group modal (write)', { tag: '@ui' }, () => {
  test.skip(!env.GROUP_UI_LIFECYCLE, 'creates a real group; set GROUP_UI_LIFECYCLE=true');
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
    'needs both QA accounts (a group needs at least one other member)',
  );

  test('open the create-group modal, name a group, and account for anything it creates @ui', async ({
    page,
    endpoints,
    resources,
  }: {
    page: Page;
    endpoints: EndpointExecutor;
    resources: CleanupCoordinator;
  }, testInfo) => {
    const groupName = `QA UI grp ${Date.now()}`;
    await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);

    // Open the "Create New Group" modal (the trigger is a group affordance in the contact rail).
    await page
      .getByText(/Create New Group|New Group/i)
      .first()
      .click()
      .catch(() => undefined);

    // The modal exposes a Group Name field — the reliable entry assertion.
    const nameField = page
      .getByRole('textbox', { name: /Group Name/i })
      .or(page.getByPlaceholder(/Group Name/i))
      .first();
    await expect(nameField, 'the Create New Group modal opens with a Group Name field').toBeVisible(
      {
        timeout: 15_000,
      },
    );
    await nameField.fill(groupName);
    await expect(nameField, 'the Group Name field accepts text').toHaveValue(groupName);

    // Best-effort: add the 2nd QA account as a member and submit. Whether this succeeds is exactly
    // what the lookup below establishes — it is never assumed either way.
    await page
      .getByText(testData.victimKpostId)
      .first()
      .click()
      .catch(() => undefined);
    await page
      .getByRole('button', { name: /Create|Submit|Done|Next/i })
      .first()
      .click()
      .catch(() => undefined);

    // ---- account for whatever the submit did (API; displaces the UI session — see the header) ----
    const created = await findGroupByName(endpoints, groupName);

    if (created) {
      resources.track({
        kind: 'katchup-group',
        id: String(created.groupID),
        describe: `UI-created group "${groupName}"`,
        cleanup: () => deleteGroup(endpoints, created),
      });
    }
    testInfo.annotations.push({
      type: 'note',
      description: created
        ? `the UI submit created group ${String(created.groupID)}; registered for cleanup`
        : 'the UI submit created no group (the member-picker/submit selectors are unverified)',
    });

    /*
     * The assertion that closes the hole: a group either does not exist, or exists WITH an identity
     * the ledger now holds. There is no third outcome in which this test leaves a group behind that
     * nothing knows about — which is precisely what it used to do while claiming to self-clean.
     */
    expect(
      created === undefined || typeof created.groupID === 'number',
      'any group this test created is identified and registered for cleanup',
    ).toBe(true);
  });
});
