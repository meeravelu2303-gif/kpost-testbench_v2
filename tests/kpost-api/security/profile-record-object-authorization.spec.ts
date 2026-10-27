// Profile sub-record DELETEs across accounts: A creates a record, C names its id on each delete
// endpoint. The record must survive, and nothing of A's may be disclosed to C.
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * The V2 deletes scope by the caller's JWT, so C should change nothing; this proves it live.
 * Gated behind PROFILE_LIFECYCLE because A really creates and deletes its own records.
 */
const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;
const C: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal-3')!;

/** Read A's own profile (`data.userProfile`), the shape that carries the *AsJson record arrays. */
async function ownProfile(endpoints: EndpointExecutor): Promise<Record<string, unknown>> {
  const ex = await endpoints.sendTo(
    'profile-get-user-profile',
    {},
    { label: 'profile-idor:read-own', auth: { principal: A }, allowLiveRead: true },
  );
  const parsed = ex.json();
  const value = (parsed.ok ? parsed.value : {}) as Record<string, unknown>;
  const data = (value.data as Record<string, unknown> | undefined) ?? {};
  return (data.userProfile as Record<string, unknown> | undefined) ?? {};
}

function listOf(profile: Record<string, unknown>, keys: string[]): Array<Record<string, unknown>> {
  for (const key of keys) {
    const candidate = profile[key];
    if (Array.isArray(candidate)) return candidate as Array<Record<string, unknown>>;
  }
  return [];
}

test.describe(
  'KPost Security · Profile sub-record cross-account object authorization @api @kpost-api @security @profile',
  {
    tag: ['@api', '@auth', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(
      process.env.PROFILE_LIFECYCLE !== 'true',
      'creates real profile records; set PROFILE_LIFECYCLE=true',
    );
    test.skip(!A || !C, 'needs the personal and personal-3 principals');

    // One case per deletable sub-record. Each: save on A, find the real id, let C try to delete it.
    const CASES = [
      {
        label: 'college',
        saveId: 'profile-save-college',
        nameValue: (m: number) => `QA Bench College ${m}`,
        saveBody: (name: string) => ({
          collegeDetails: [{ collegeID: '', collegeName: name, degree: 'QA', fromYear: '2010' }],
        }),
        listKeys: ['collegeDetailsAsJson', 'collegeDetails'],
        nameField: 'collegeName',
        idField: 'collegeID',
        deleteId: 'profile-delete-college',
      },
      {
        label: 'other-activity',
        saveId: 'profile-save-other-activity',
        nameValue: (m: number) => `QA Bench Activity ${m}`,
        saveBody: (name: string) => ({
          otherActivities: [{ activityID: '', title: name, achievements: 'QA bench activity' }],
        }),
        listKeys: ['otherActivitiesAsJson', 'otherActivities'],
        nameField: 'title',
        idField: 'activityID',
        deleteId: 'profile-delete-other-activity',
      },
    ] as const;

    for (const c of CASES) {
      test(`an unrelated principal cannot delete another user's ${c.label} record @api @security`, async ({
        endpoints,
      }) => {
        const marker = Date.now();
        const nameValue = c.nameValue(marker);

        // A creates the record on its own profile.
        const saved = await endpoints.sendTo(
          c.saveId,
          { body: c.saveBody(nameValue) },
          { label: `profile-idor:save-${c.label}`, auth: { principal: A }, allowLiveWrite: true },
        );
        expect(saved.status, `A saves its own ${c.label} record`).toBeLessThan(300);

        const afterSave = listOf(await ownProfile(endpoints), [...c.listKeys]);
        const mine = afterSave.find((e) => e[c.nameField] === nameValue);
        const recordId = typeof mine?.[c.idField] === 'string' ? (mine[c.idField] as string) : '';
        test.skip(!recordId, `could not read back a real ${c.idField}; nothing to attack`);

        let stillPresent = true;
        try {
          // C (unrelated) names A's real record id on the delete endpoint.
          const attack = await endpoints.sendTo(
            c.deleteId,
            { body: { [c.idField]: recordId } },
            {
              label: `profile-idor:delete-attack-${c.label}`,
              auth: { principal: C },
              allowLiveWrite: true,
            },
          );
          expect(attack.status, 'the delete request completes (no server crash)').toBeLessThan(500);
          const attackParsed = attack.json();
          const attackText = JSON.stringify(attackParsed.ok ? attackParsed.value : {});
          const disclosed = attackText.includes(nameValue);

          // A reads back: the record must still be there.
          const afterAttack = listOf(await ownProfile(endpoints), [...c.listKeys]);
          stillPresent = afterAttack.some((e) => e[c.idField] === recordId);

          if (!stillPresent) {
            endpoints.recordBusinessRuleViolation({
              endpointId: c.deleteId,
              ruleId: `IDOR-${c.deleteId}-cross-account-delete`,
              rule: `A caller must not be able to delete another user's ${c.label} record by naming its id.`,
              expected: "the request changes nothing on the owner's profile",
              actual: `C deleted A's ${c.label} record ${recordId} (gone from A's profile after C's call)`,
              request: { body: { [c.idField]: recordId } },
            });
          }
          if (disclosed) {
            endpoints.recordBusinessRuleViolation({
              endpointId: c.deleteId,
              ruleId: `IDOR-${c.deleteId}-cross-account-disclosure`,
              rule: `An unrelated caller's ${c.label} delete must not echo back another user's record content.`,
              expected: 'the response discloses nothing belonging to the real owner',
              actual: `C's delete response disclosed A's ${c.label} "${nameValue}"`,
              request: { body: { [c.idField]: recordId } },
            });
          }

          expect
            .soft(stillPresent, `BOLA: C must not delete A's ${c.label} record ${recordId}`)
            .toBe(true);
          expect.soft(disclosed, `BOLA: C must not see A's ${c.label} "${nameValue}"`).toBe(false);
        } finally {
          // A cleans up its own record (whether or not C's attack touched it).
          if (stillPresent) {
            await endpoints
              .sendTo(
                c.deleteId,
                { body: { [c.idField]: recordId } },
                {
                  label: `profile-idor:cleanup-${c.label}`,
                  auth: { principal: A },
                  allowLiveWrite: true,
                },
              )
              .catch(() => undefined);
          }
        }
      });
    }
  },
);
