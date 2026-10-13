import { AUTH_PROFILES } from '@config/auth-profile';
import { expect, test } from '@fixtures';

/**
 * Maintenance: delete the groups the UI specs create (`support/groups.ts` names them
 * `QA UI <label> <timestamp>`) and could not tear down.
 *
 * Why it exists (2026-10-10): `deleteGroup` is refused while members remain, and
 * `removeGroupMember` answers HTTP 500 ("Remove user from an Existing Group failed") for every
 * well-formed call — owner or co-admin, fresh group or old, bench names or real names — so a group
 * with members cannot be cleaned up through the API at all right now. Each Group Info / targeting
 * run therefore leaves its groups behind. Run this once the removal route works again:
 *
 *   QA_GROUP_CLEANUP=true QATEST_ONLY=true npx playwright test --project=api tests/api/kpost/group/qa-ui-group-cleanup.spec.ts
 *
 * It only touches groups whose name starts with "QA UI " and only through the two qatest accounts
 * that create them. Skipped unless `QA_GROUP_CLEANUP=true`.
 */
const OWNERS = ['personal', 'personal-3']
  .map((key) => AUTH_PROFILES.kpost.principals.find((p) => p.key === key))
  .filter((p): p is NonNullable<typeof p> => Boolean(p));

interface Found {
  groupKpostID: string;
  groupID: number;
  groupKpostName: string;
  members: string[];
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
              });
            }
            Object.values(o).forEach(walk);
          }
        };
        walk(parsed.ok ? parsed.value : {});
        const mine = found.filter((g) => /^QA UI /.test(g.groupKpostName));
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
