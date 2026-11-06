import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import type { DatabaseClient } from '@database/database-client';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { expectStored } from '../../../support/db-stored';

/**
 * Cross-user checks for group leave, the V1 legacy remove-member route, the full group photo and the
 * POST attachment check. The owner makes a throwaway record; an unrelated QA account (or a plain
 * member) then names it. Every probe has an owner control (the owner's or the member's own identical
 * call works), and the verdict is read back from the database or from what was actually returned,
 * not from the status code. QA accounts only; every record made here is deleted in `finally`.
 *
 * Not probed here, by design (each acts only on the caller's own rows, the owner coming from the
 * token): contacts deleteContact / blockOrUnBlockContact / blockOrUnBlockMultipleContact /
 * addContactReference (ContactsDirectoryDaoImpl.java:573-604, `where kpostID = :kpostID`, set from
 * the token in ContactsDirectoryControllerV2.java:571/760/818/1214).
 */

const K = AUTH_PROFILES.kpost;
const principal = (key: string): Principal | undefined => K.principals.find((p) => p.key === key);
const OWNER = principal('personal-3');
const MEMBER = principal('personal-4');
const OUTSIDER = principal('personal-5');
const SECOND_MEMBER = principal('personal');
const THIRD_MEMBER = principal('victim');

const MEMBERS = 'TBL_KPOST_USERGROUP_MEMBERDETAILS';
const MESSAGES = 'TBL_KPOST_KATCHUP_MESSAGES';

const GROUP_IMAGE_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
  'base64',
);

interface Group {
  groupID: number;
  groupKpostID: string;
}

const groupMember = (kpostID: string, isAdmin = false): Record<string, unknown> => ({
  createdBy: OWNER?.username,
  hasAdminAccess: isAdmin ? 'Y' : 'N',
  kpostID,
  name: 'QA Bench',
  memberDesignation: '',
  privacyStatus: 'Y',
  remarks: 'created',
});

/** One call as `who`. A refusal by the bench's own guard comes back as status -1, never a throw. */
async function as(
  endpoints: EndpointExecutor,
  who: Principal,
  id: string,
  spec: {
    body?: Record<string, unknown>;
    multipart?: Record<string, unknown>;
    pathParams?: Record<string, string | number>;
  },
  label: string,
  owned: readonly (string | number)[] = [],
): Promise<{ status: number; bodyText: string; correlationId?: string }> {
  try {
    const ex = await endpoints.sendTo(id, spec as never, {
      label: `xuser:${label}`,
      auth: { principal: who },
      allowLiveWrite: true,
      ownedIdentifiers: owned,
    });
    return { status: ex.status, bodyText: ex.bodyText ?? '', correlationId: ex.correlationId };
  } catch {
    return { status: -1, bodyText: '' };
  }
}

async function membership(database: DatabaseClient, group: Group, kpostID: string) {
  const row = await database.findOne<{ id: number; removed_flag: number }>({
    table: MEMBERS,
    where: { group_id: group.groupID, kpost_id: kpostID },
  });
  return row ? { id: Number(row.id), present: Number(row.removed_flag) === 0 } : undefined;
}

/** Katchup messages `sender` posted into the group (the leave/remove alert is one such message). */
const postedBy = (database: DatabaseClient, group: Group, sender: string): Promise<number> =>
  database.count({ table: MESSAGES, where: { receiver: group.groupKpostID, sender } });

/**
 * The owner creates a group with `members` as plain members, runs `body`, then removes whoever is
 * still active and deletes the group (deleteGroup refuses while anyone but the admin remains).
 */
async function withGroup(
  endpoints: EndpointExecutor,
  database: DatabaseClient,
  members: string[],
  body: (group: Group, owned: (string | number)[]) => Promise<void>,
): Promise<void> {
  let group: Group | undefined;
  const owned: (string | number)[] = [];
  try {
    const ex = await endpoints.sendTo(
      'group-create',
      {
        body: {
          activeStatus: 'Y',
          createdBy: OWNER!.username,
          groupPicturePath: null,
          groupCreateAccess: true,
          groupKpostName: `QA XUser Group ${Date.now()}`,
          isPrivateGroup: 'N',
          memberDetails: [
            ...members.map((m) => groupMember(m)),
            groupMember(OWNER!.username, true),
          ],
        },
      },
      { label: 'xuser:group-create', auth: { principal: OWNER! }, allowLiveWrite: true },
    );
    const parsed = ex.json();
    const data = ((parsed.ok ? parsed.value : {}) as { data?: Record<string, unknown> }).data ?? {};
    const groupID = Number(data.groupID ?? 0);
    const groupKpostID = typeof data.groupKpostID === 'string' ? data.groupKpostID : '';
    // Blocker: without the group no other step can run.
    expect(groupID && groupKpostID, `the owner created the group (${ex.status})`).toBeTruthy();
    group = { groupID, groupKpostID };
    owned.push(groupID, groupKpostID);
    for (const m of members) {
      const row = await membership(database, group, m);
      if (row) owned.push(row.id);
    }
    await body(group, owned);
  } finally {
    if (group) {
      const rows = await database
        .findMany<{ kpost_id: string }>({
          table: MEMBERS,
          where: { group_id: group.groupID, removed_flag: 0 },
        })
        .catch(() => []);
      const left = rows.map((r) => r.kpost_id).filter((k) => k !== OWNER!.username);
      if (left.length)
        await as(
          endpoints,
          OWNER!,
          'group-remove-member',
          {
            body: {
              memberKpostIdList: left,
              groupID: group.groupID,
              groupKpostID: group.groupKpostID,
            },
          },
          'cleanup-remove',
          owned,
        );
      const deleted = await as(
        endpoints,
        OWNER!,
        'group-delete',
        { body: { groupID: group.groupID } },
        'cleanup-delete',
        owned,
      );
      expect.soft(deleted.status, 'the throwaway group is deleted (nothing left behind)').toBe(200);
    }
  }
}

/** Both routes post the "left" / "removed" Katchup alert before they check who is asking. */
const ALERT_CAUSE =
  'GroupServiceImpl.leaveGroup and removeOrLeaveFromGroup send the "left the group" / "removed" Katchup alert ' +
  '(sendKatchUpMessageForLeftOrRemovedFromGroup) before the DAO checks the caller, so a refused call still posts ' +
  'a message into the group in the caller’s name.';

test.describe(
  'KPost Security · group and attachment cross-user access @api @kpost-api @security @database',
  {
    tag: ['@api', '@auth', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.describe.configure({ mode: 'default' });

    test('a stranger cannot make a member leave a group by naming their membership row @api @kpost-api @security', async ({
      endpoints,
      databases,
    }) => {
      test.skip(
        process.env.GROUP_LIFECYCLE !== 'true',
        'creates a throwaway group; set GROUP_LIFECYCLE=true',
      );
      test.skip(
        !OWNER || !MEMBER || !OUTSIDER || !SECOND_MEMBER,
        'needs four KPost principals (personal, personal-3..5)',
      );
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection to judge by the row');

      await withGroup(
        endpoints,
        database,
        [MEMBER!.username, SECOND_MEMBER!.username],
        async (group, owned) => {
          const target = await membership(database, group, MEMBER!.username);
          const control = await membership(database, group, SECOND_MEMBER!.username);
          expect(target?.present && control?.present, 'both members are in the group').toBe(true);

          // Owner control: a member leaving with their own row id works.
          const own = await as(
            endpoints,
            SECOND_MEMBER!,
            'group-leave',
            {
              body: {
                id: String(control!.id),
                groupID: group.groupID,
                groupKpostID: group.groupKpostID,
              },
            },
            'leave-own',
            owned,
          );
          expect(own.status, 'control: a member can leave with their own membership row').toBe(200);
          expect(
            (await membership(database, group, SECOND_MEMBER!.username))?.present,
            'control: the leaving member’s row is marked removed',
          ).toBe(false);

          // Probe 1: the outsider names the target's membership row id.
          const foreignBody = {
            id: String(target!.id),
            groupID: group.groupID,
            groupKpostID: group.groupKpostID,
          };
          const foreign = await as(
            endpoints,
            OUTSIDER!,
            'group-leave',
            { body: foreignBody },
            'leave-foreign-row',
            owned,
          );
          const afterForeign = await membership(database, group, MEMBER!.username);
          if (!afterForeign?.present)
            endpoints.recordBusinessRuleViolation({
              endpointId: 'group-leave',
              ruleId: 'IDOR-GROUP-LEAVE-FOREIGN-ROW',
              rule: 'leaveFromGroup must only remove the caller’s own membership row, whatever row id the body names.',
              expected: `${MEMBER!.username} stays in group ${group.groupID}`,
              actual: `HTTP ${foreign.status}: ${MEMBER!.username} was removed after ${OUTSIDER!.username} sent their row id ${target!.id}`,
              request: { body: foreignBody },
              correlationId: foreign.correlationId,
            });
          expect
            .soft(
              !afterForeign?.present,
              'a stranger naming a member’s row id must not remove them',
            )
            .toBe(false);

          // Probe 2: the same, with the extra UserGroupRO fields a caller can set. The leave alert
          // rewrites the request's kpostID from memberKpostIdList before the DAO's caller check runs.
          if (afterForeign?.present) {
            const overrideBody = {
              ...foreignBody,
              memberKpostIdList: [MEMBER!.username],
              groupAdmin: OUTSIDER!.username,
            };
            const override = await as(
              endpoints,
              OUTSIDER!,
              'group-leave',
              { body: overrideBody },
              'leave-member-list-override',
              owned,
            );
            const afterOverride = await membership(database, group, MEMBER!.username);
            if (!afterOverride?.present)
              endpoints.recordBusinessRuleViolation({
                endpointId: 'group-leave',
                ruleId: 'IDOR-GROUP-LEAVE-MEMBER-LIST-OVERRIDE',
                rule:
                  'leaveFromGroup must check the logged-in caller, not a kpostID taken from the body. ' +
                  'GroupServiceImpl.sendKatchUpMessageForLeftOrRemovedFromGroup copies memberKpostIdList into the ' +
                  'request’s kpostID before leaveGroupUpdateGroupFlag compares it with the membership row.',
                expected: `${MEMBER!.username} stays in group ${group.groupID}`,
                actual: `HTTP ${override.status}: ${MEMBER!.username} was removed by ${OUTSIDER!.username} sending memberKpostIdList [${MEMBER!.username}]`,
                request: { body: overrideBody },
                correlationId: override.correlationId,
              });
            expect
              .soft(
                !afterOverride?.present,
                'a stranger adding memberKpostIdList must not remove the member either',
              )
              .toBe(false);
          }

          // Side effect of the refused calls: no message from the outsider lands in the group.
          const injected = await postedBy(database, group, OUTSIDER!.username);
          if (injected > 0)
            endpoints.recordBusinessRuleViolation({
              endpointId: 'group-leave',
              ruleId: 'IDOR-GROUP-LEAVE-ALERT-BEFORE-CHECK',
              rule: `A refused leaveFromGroup must not post anything into the group. ${ALERT_CAUSE}`,
              expected: `no Katchup message from ${OUTSIDER!.username} in group ${group.groupKpostID}`,
              actual: `${injected} message(s) from ${OUTSIDER!.username} (not a member) were posted into the group`,
              request: { body: foreignBody },
              correlationId: foreign.correlationId,
            });
          expect
            .soft(
              injected > 0,
              'a non-member’s refused leave must not post a message into the group',
            )
            .toBe(false);
        },
      );
    });

    test('the V1 legacy removeGroupMember route refuses a stranger and a plain member @api @kpost-api @security', async ({
      endpoints,
      databases,
    }) => {
      test.skip(
        process.env.GROUP_LIFECYCLE !== 'true',
        'creates a throwaway group; set GROUP_LIFECYCLE=true',
      );
      test.skip(
        !OWNER || !MEMBER || !OUTSIDER || !SECOND_MEMBER || !THIRD_MEMBER,
        'needs five KPost principals (personal, victim, personal-3..5)',
      );
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection to judge by the row');

      await withGroup(
        endpoints,
        database,
        [MEMBER!.username, SECOND_MEMBER!.username, THIRD_MEMBER!.username],
        async (group, owned) => {
          const removeBody = (kpostID: string) => ({
            memberKpostIdList: [kpostID],
            groupID: group.groupID,
            groupKpostID: group.groupKpostID,
          });

          // Owner control: the owner's identical legacy call removes a member.
          const own = await as(
            endpoints,
            OWNER!,
            'group-remove-member-v1-legacy',
            { body: removeBody(THIRD_MEMBER!.username) },
            'legacy-remove-owner',
            owned,
          );
          expect(own.status, 'control: the owner can remove a member on the legacy route').toBe(
            200,
          );
          expect(
            (await membership(database, group, THIRD_MEMBER!.username))?.present,
            'control: the removed member’s row is marked removed',
          ).toBe(false);
          // GroupController.java:92 → GroupServiceDaoImpl.java:201-207: removed_flag, admin_access N, remarks "removed".
          await expectStored(
            database,
            'group-remove-member-v1-legacy',
            {
              table: MEMBERS,
              where: { group_id: group.groupID, kpost_id: THIRD_MEMBER!.username },
              columns: { removed_flag: true, admin_access: 'N', remarks: 'removed' },
              rule: 'the legacy removeGroupMember marks the removed member\'s row removed with remarks "removed"',
            },
            endpoints,
          );

          for (const [who, role] of [
            [OUTSIDER!, 'a stranger'],
            [SECOND_MEMBER!, 'a plain member'],
          ] as const) {
            const before = await postedBy(database, group, who.username);
            const res = await as(
              endpoints,
              who,
              'group-remove-member-v1-legacy',
              { body: removeBody(MEMBER!.username) },
              `legacy-remove-${role.replace(/\W+/g, '-')}`,
              owned,
            );
            const after = await membership(database, group, MEMBER!.username);
            if (!after?.present)
              endpoints.recordBusinessRuleViolation({
                endpointId: 'group-remove-member-v1-legacy',
                ruleId: 'IDOR-GROUP-REMOVE-LEGACY',
                rule: 'The legacy /group/removeGroupMember route must let only the group owner or a co-admin remove members (the same rule as /v2/group/removeGroupMember).',
                expected: `${MEMBER!.username} stays in group ${group.groupID}`,
                actual: `HTTP ${res.status}: ${role} (${who.username}) removed ${MEMBER!.username}`,
                request: { body: removeBody(MEMBER!.username) },
                correlationId: res.correlationId,
              });
            expect
              .soft(!after?.present, `${role} must not remove a member on the legacy route`)
              .toBe(false);

            const injected = (await postedBy(database, group, who.username)) - before;
            if (injected > 0)
              endpoints.recordBusinessRuleViolation({
                endpointId: 'group-remove-member-v1-legacy',
                ruleId: 'IDOR-GROUP-REMOVE-LEGACY-ALERT-BEFORE-CHECK',
                rule: `A refused removeGroupMember must not post a "removed" alert into the group. ${ALERT_CAUSE}`,
                expected: `no Katchup message from ${who.username} in group ${group.groupKpostID}`,
                actual: `${injected} message(s) from ${role} (${who.username}) were posted into the group`,
                request: { body: removeBody(MEMBER!.username) },
                correlationId: res.correlationId,
              });
            expect
              .soft(
                injected > 0,
                `${role}'s refused removal must not post a message into the group`,
              )
              .toBe(false);
          }
        },
      );
    });

    test('a stranger cannot download a group’s full photo @api @kpost-api @security', async ({
      endpoints,
      databases,
    }) => {
      test.skip(
        process.env.GROUP_LIFECYCLE !== 'true',
        'creates a throwaway group with a photo; set GROUP_LIFECYCLE=true',
      );
      test.skip(!OWNER || !MEMBER || !OUTSIDER, 'needs three KPost principals (personal-3..5)');
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection to clean the group up');

      await withGroup(endpoints, database, [MEMBER!.username], async (group, owned) => {
        let uploaded = false;
        try {
          // The photo is a 1x1 JPEG (well under the 64 KB upload cap).
          const upload = await as(
            endpoints,
            OWNER!,
            'group-update-image',
            {
              multipart: {
                file: { name: 'qa-bench.jpg', mimeType: 'image/jpeg', buffer: GROUP_IMAGE_JPEG },
                text: JSON.stringify({ groupKpostID: group.groupKpostID }),
              },
            },
            'image-upload',
            owned,
          );
          uploaded = upload.status === 200;
          expect(upload.status, 'the owner set the group photo').toBe(200);

          const download = (who: Principal, label: string) =>
            endpoints.sendTo(
              'group-download-full-image',
              { pathParams: { groupKpostID: group.groupKpostID, kpostID: who.username } },
              {
                label: `xuser:${label}`,
                auth: { principal: who },
                allowLiveRead: true,
                ownedIdentifiers: owned,
              },
            );
          const own = await download(OWNER!, 'full-image-owner');
          expect(
            own.status === 200 && (own.bodyText ?? '').length > 0,
            `control: the owner downloads the photo (HTTP ${own.status})`,
          ).toBe(true);

          const foreign = await download(OUTSIDER!, 'full-image-outsider');
          const leaked = foreign.status === 200 && (foreign.bodyText ?? '').length > 0;
          if (leaked)
            endpoints.recordBusinessRuleViolation({
              endpointId: 'group-download-full-image',
              ruleId: 'IDOR-GROUP-FULL-IMAGE',
              rule: 'downloadGroupFullProfileImage must serve the photo only to a current member of the group.',
              expected: 'HTTP 403 and no image for a non-member',
              actual: `HTTP ${foreign.status}: ${OUTSIDER!.username} (not a member) received ${(foreign.bodyText ?? '').length} bytes of group ${group.groupKpostID}'s photo`,
              request: {
                pathParams: { groupKpostID: group.groupKpostID, kpostID: OUTSIDER!.username },
              },
              correlationId: foreign.correlationId,
            });
          expect.soft(leaked, 'a non-member must not receive the group photo').toBe(false);
        } finally {
          if (uploaded)
            await as(
              endpoints,
              OWNER!,
              'group-remove-image',
              { body: { groupKpostID: group.groupKpostID } },
              'image-cleanup',
              owned,
            );
        }
      });
    });

    test('a stranger cannot read our attachment’s upload state by its uuid (POST check) @api @kpost-api @security', async ({
      endpoints,
    }) => {
      test.skip(process.env.AWS_LIFECYCLE !== 'true', 'presigns an S3 key; set AWS_LIFECYCLE=true');
      const owner = principal('personal');
      test.skip(!owner || !OUTSIDER, 'needs two KPost principals (personal, personal-5)');

      const generated = await endpoints.sendTo(
        'aws-generate-presigned',
        { body: { extension: 'pdf', fileName: 'qa-bench.pdf', fileSize: '940' } },
        { label: 'xuser:presign', auth: { principal: owner! }, allowLiveWrite: true },
      );
      const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
        generated.bodyText ?? '',
      )?.[1];
      expect(uuid, `our presign minted a uuid (HTTP ${generated.status})`).toBeTruthy();
      try {
        const check = async (who: Principal, label: string) => {
          const ex = await endpoints.sendTo(
            'aws-check-attachment',
            { body: { attachmentsUuid: [uuid!] } },
            { label, auth: { principal: who }, allowLiveRead: true, ownedIdentifiers: [uuid!] },
          );
          const parsed = ex.json();
          const data = ((parsed.ok ? parsed.value : {}) as { data?: unknown }).data;
          const entry = Array.isArray(data)
            ? (data as Record<string, unknown>[]).find((m) => m && uuid! in m)
            : undefined;
          return { ex, code: entry ? String(entry[uuid!]) : undefined };
        };
        // Codes from the reply: 0 uploaded, 1 folder only, 2 nothing uploaded, 3 Invalid_user.
        const own = await check(owner!, 'xuser:s3-check-post-owner');
        expect(
          own.code !== undefined && own.code !== '3',
          `control: we get our own uuid's upload state (HTTP ${own.ex.status}, code ${String(own.code)})`,
        ).toBe(true);

        const foreign = await check(OUTSIDER!, 'xuser:s3-check-post-outsider');
        const leaked = foreign.code !== undefined && foreign.code !== '3';
        if (leaked)
          endpoints.recordBusinessRuleViolation({
            endpointId: 'aws-check-attachment',
            ruleId: 'IDOR-S3-CHECK-POST',
            rule: 'checkAttachmentS3 (POST) must answer "3" (Invalid_user) for a uuid the caller does not own.',
            expected: `code "3" for ${OUTSIDER!.username} (the owner got "${String(own.code)}")`,
            actual: `HTTP ${foreign.ex.status}: ${OUTSIDER!.username} got code "${String(foreign.code)}" for ${owner!.username}'s uuid`,
            request: { body: { attachmentsUuid: [uuid!] } },
            correlationId: foreign.ex.correlationId,
          });
        expect.soft(leaked, 'a stranger is not told the upload state of our uuid').toBe(false);
      } finally {
        await endpoints
          .sendTo(
            'aws-delete-attachment',
            { pathParams: { uuid: uuid ?? '' } },
            {
              label: 'xuser:s3-cleanup',
              auth: { principal: owner! },
              allowLiveWrite: true,
              ownedIdentifiers: uuid ? [uuid] : [],
            },
          )
          .catch(() => undefined);
      }
    });
  },
);
