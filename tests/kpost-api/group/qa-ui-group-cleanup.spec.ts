import { AUTH_PROFILES } from '@config/auth-profile';
import { expect, test } from '@fixtures';

/**
 * Maintenance: delete leftover "QA " groups the UI specs could not tear down, via the qatest owners.
 * Members are removed (or, if removeGroupMember fails, each leaves on their own) before the delete.
 * Skipped unless `QA_GROUP_CLEANUP=true`.
 */
const OWNERS = ['personal', 'personal-3']
  .map((key) => AUTH_PROFILES.kpost.principals.find((p) => p.key === key))
  .filter((p): p is NonNullable<typeof p> => Boolean(p));
/** Every qatest principal — used to make a member leave a group on their own. */
const PRINCIPALS = AUTH_PROFILES.kpost.principals;

interface Found {
  groupKpostID: string;
  groupID: number;
  groupKpostName: string;
  members: string[];
  /** kpostID → membership-row id; `group-leave` must name the leaver's own row id. */
  rowIds: Record<string, number>;
}

test.describe(
  'maintenance · QA UI group cleanup',
  { tag: ['@maintenance', '@api', '@group', '@regression'] },
  () => {
    test.skip(
      process.env.QA_GROUP_CLEANUP !== 'true',
      'maintenance only; set QA_GROUP_CLEANUP=true',
    );

    test('remove members, then delete every leftover "QA UI *" group', async ({ endpoints }) => {
      test.setTimeout(600_000);
      let remaining = 0;
      for (const who of OWNERS) {
        const ex = await endpoints.sendTo(
          'contacts-my-groups',
          { body: { lastfetchDate: null } },
          { label: `cleanup:my-groups:${who.key}`, auth: { principal: who }, allowLiveRead: true },
        );
        expect(ex.status, `myGroups answered for ${who.key}`).toBeLessThan(400);
        const parsed = ex.json();
        const found: Found[] = [];
        const walk = (v: unknown): void => {
          if (Array.isArray(v)) return v.forEach(walk);
          if (v && typeof v === 'object') {
            const o = v as Record<string, unknown>;
            if (typeof o.groupKpostName === 'string' && typeof o.groupKpostID === 'string') {
              const md = Array.isArray(o.memberDetails)
                ? (o.memberDetails as Record<string, unknown>[])
                : [];
              found.push({
                groupKpostID: o.groupKpostID,
                groupID: Number(o.groupID ?? 0),
                groupKpostName: o.groupKpostName,
                members: md
                  .filter((m) => m.removedFlag !== true)
                  .map((m) => (typeof m.kpostID === 'string' ? m.kpostID : ''))
                  .filter(Boolean),
                rowIds: Object.fromEntries(
                  md
                    .filter((m) => typeof m.kpostID === 'string' && typeof m.id === 'number')
                    .map((m) => [m.kpostID as string, m.id as number]),
                ),
              });
            }
            Object.values(o).forEach(walk);
          }
        };
        walk(parsed.ok ? parsed.value : {});
        // Every bench-created group name starts with "QA "; only qatest-owned groups are listed.
        const mine = found.filter((g) => /^QA /.test(g.groupKpostName));
        console.log(`[${who.key}] groups: ${found.length}; QA UI leftovers: ${mine.length}`);
        for (const g of mine) {
          const others = g.members.filter((id) => id !== who.username);
          if (others.length) {
            const rm = await endpoints.sendTo(
              'group-remove-member',
              {
                body: {
                  memberKpostIdList: others,
                  groupID: g.groupID,
                  groupKpostID: g.groupKpostID,
                },
              },
              { label: 'cleanup:remove-members', auth: { principal: who }, allowLiveWrite: true },
            );
            console.log(`  remove ${others.length} from ${g.groupKpostName} -> ${rm.status}`);
            if (rm.status >= 300) {
              // Removal failed: each qatest member leaves on their own instead.
              for (const id of others) {
                const member = PRINCIPALS.find((p) => p.username === id);
                if (!member) continue;
                const leave = await endpoints.sendTo(
                  'group-leave',
                  // The leaver's OWN membership-row id ('0' answers 400 "you are not a member").
                  {
                    body: {
                      id: String(g.rowIds[id] ?? ''),
                      groupID: g.groupID,
                      groupKpostID: g.groupKpostID,
                    },
                  },
                  {
                    label: 'cleanup:self-leave',
                    auth: { principal: member },
                    allowLiveWrite: true,
                  },
                );
                console.log(`    ${member.key} leaves -> ${leave.status}`);
              }
            }
          }
          const del = await endpoints.sendTo(
            'group-delete',
            { body: { groupID: g.groupID, groupKpostID: g.groupKpostID } },
            { label: 'cleanup:delete', auth: { principal: who }, allowLiveWrite: true },
          );
          console.log(`  delete ${g.groupKpostName} -> ${del.status}`);
          if (del.status >= 300) remaining++;
        }
      }
      test.info().annotations.push({
        type: 'observed',
        description: `QA UI groups still undeletable after this pass: ${remaining}`,
      });
    });
  },
);
