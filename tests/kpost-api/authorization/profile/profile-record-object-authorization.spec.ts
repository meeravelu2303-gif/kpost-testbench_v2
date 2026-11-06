// Profile sub-records across accounts (college, school, university, experience, other activity):
// A creates a record, C names its id on the save (update) route and on the delete route. The record
// must keep A's values and survive, and nothing of A's may be disclosed to C.
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { restoreStep } from '../../../support/flow-restore';
import { retryOrSkip } from '../../../support/live-condition';

/**
 * The V2 deletes scope by the caller's JWT, so C should change nothing; this proves it live.
 * Gated behind PROFILE_LIFECYCLE because A really creates and deletes its own records.
 */
const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;
const C: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal-3')!;

/**
 * Read a user's own profile (`data.userProfile`), the shape that carries the *AsJson arrays.
 * Only a 200 is evidence: a lost session (401, someone else signed in to the account) is logged in
 * again once, and a read that still fails retries or skips the test; it never reads as an empty
 * profile, which would look like "the record was deleted" (a false finding on 2026-11-05).
 */
async function ownProfile(
  endpoints: EndpointExecutor,
  who: Principal = A,
): Promise<Record<string, unknown>> {
  const read = () =>
    endpoints.sendTo(
      'profile-get-user-profile',
      {},
      { label: 'profile-idor:read-own', auth: { principal: who }, allowLiveRead: true },
    );
  let ex = await read();
  if (ex.status === 401) {
    endpoints.tokens.forget(who);
    ex = await read();
  }
  retryOrSkip(ex.status !== 200, `${who.key}'s own profile read answered HTTP ${ex.status}`);
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

    // One case per sub-record. Each: save on A, find the real id, let C try to overwrite it (the
    // save route with A's id) and then delete it. `id` is '' for a new record.
    const CASES: ReadonlyArray<{
      label: string;
      saveId: string;
      nameValue: (m: number) => string;
      saveBody: (name: string, id: string) => Record<string, unknown>;
      listKeys: readonly string[];
      nameField: string;
      idField: string;
      deleteId: string;
      needsCompanyName?: boolean;
    }> = [
      {
        label: 'college',
        saveId: 'profile-save-college',
        nameValue: (m) => `QA Bench College ${m}`,
        saveBody: (name, id) => ({
          collegeDetails: [{ collegeID: id, collegeName: name, degree: 'QA', fromYear: '2010' }],
        }),
        listKeys: ['collegeDetailsAsJson', 'collegeDetails'],
        nameField: 'collegeName',
        idField: 'collegeID',
        deleteId: 'profile-delete-college',
      },
      {
        label: 'other-activity',
        saveId: 'profile-save-other-activity',
        nameValue: (m) => `QA Bench Activity ${m}`,
        saveBody: (name, id) => ({
          otherActivities: [{ activityID: id, title: name, achievements: 'QA bench activity' }],
        }),
        listKeys: ['otherActivitiesAsJson', 'otherActivities'],
        nameField: 'title',
        idField: 'activityID',
        deleteId: 'profile-delete-other-activity',
      },
      {
        label: 'school',
        saveId: 'profile-save-school',
        nameValue: (m) => `QA Bench School ${m}`,
        // Every field the Education screen sends (write.api.ts), so the record never blocks a save.
        saveBody: (name, id) => ({
          schoolDetails: [
            {
              schoolID: id,
              schoolName: name,
              standard: '10',
              course: 'Science',
              yearFrom: '2008',
              yearTo: '2010',
              logoPath: null,
              attachmentPath: [],
            },
          ],
        }),
        listKeys: ['schoolDetailsAsJson', 'schoolDetails'],
        nameField: 'schoolName',
        idField: 'schoolID',
        deleteId: 'profile-delete-school',
      },
      {
        label: 'university',
        saveId: 'profile-save-university',
        nameValue: (m) => `QA Bench University ${m}`,
        saveBody: (name, id) => ({
          universityDetails: [
            {
              universityID: id,
              universityName: name,
              degree: 'Masters',
              course: 'QA',
              field: 'Engineering',
              yearFrom: '2014',
              yearTo: '2016',
              logoPath: null,
              attachmentPath: [],
            },
          ],
        }),
        listKeys: ['universityDetailsAsJson', 'universityDetails'],
        nameField: 'universityName',
        idField: 'universityID',
        deleteId: 'profile-delete-university',
      },
      {
        label: 'experience',
        saveId: 'profile-save-experience',
        nameValue: (m) => `QA Bench ${m}`,
        // The company name is checked by the QA-identifier guard, so it is the QA company's own.
        saveBody: (name, id) => ({
          experienceDetails: [
            {
              experienceID: id,
              companyName: testData.companyName,
              designation: name,
              fromYear: '2020',
            },
          ],
        }),
        listKeys: ['experienceDetailsAsJson', 'experienceDetails'],
        nameField: 'designation',
        idField: 'experienceID',
        deleteId: 'profile-delete-experience',
        needsCompanyName: true,
      },
    ];

    for (const c of CASES) {
      test(`an unrelated principal cannot overwrite or delete another user's ${c.label} record @api @security`, async ({
        endpoints,
      }) => {
        test.skip(
          Boolean(c.needsCompanyName) && !process.env.QA_COMPANY_NAME,
          'set QA_COMPANY_NAME to the QA company’s real name (the QA guard checks company names)',
        );
        const marker = Date.now();
        const nameValue = c.nameValue(marker);

        // A creates the record on its own profile.
        const saved = await endpoints.sendTo(
          c.saveId,
          { body: c.saveBody(nameValue, '') },
          { label: `profile-idor:save-${c.label}`, auth: { principal: A }, allowLiveWrite: true },
        );
        expect(saved.status, `A saves its own ${c.label} record`).toBeLessThan(300);

        const afterSave = listOf(await ownProfile(endpoints), [...c.listKeys]);
        const mine = afterSave.find((e) => e[c.nameField] === nameValue);
        const recordId = typeof mine?.[c.idField] === 'string' ? (mine[c.idField] as string) : '';
        test.skip(!recordId, `could not read back a real ${c.idField}; nothing to attack`);

        let stillPresent: boolean;
        const overwrite = `${nameValue} changed by C`;
        try {
          // C names A's real record id on the save (update) route with a new name.
          const overwriteSpec = { body: c.saveBody(overwrite, recordId) };
          const rewrite = await endpoints.sendTo(c.saveId, overwriteSpec, {
            label: `profile-idor:overwrite-attack-${c.label}`,
            auth: { principal: C },
            allowLiveWrite: true,
          });
          expect
            .soft(rewrite.status, 'the overwrite request completes (no crash)')
            .toBeLessThan(500);
          const afterRewrite = listOf(await ownProfile(endpoints), [...c.listKeys]);
          const ownRecord = afterRewrite.find((e) => e[c.idField] === recordId);
          const changed = ownRecord !== undefined && ownRecord[c.nameField] !== nameValue;
          if (changed)
            endpoints.recordBusinessRuleViolation({
              endpointId: c.saveId,
              ruleId: `IDOR-${c.saveId}-cross-account-overwrite`,
              rule: `A caller must not be able to change another user's ${c.label} record by naming its id on the save route.`,
              expected: "the owner's record keeps its own values",
              actual: `C's save with A's ${c.idField} ${recordId} changed A's ${c.nameField} to "${String(ownRecord[c.nameField])}"`,
              request: overwriteSpec,
              correlationId: rewrite.correlationId,
            });
          expect
            .soft(changed, `BOLA: C must not overwrite A's ${c.label} record ${recordId}`)
            .toBe(false);
          // C's own profile may have got a new record from that save: C removes it.
          for (const own of listOf(await ownProfile(endpoints, C), [...c.listKeys]))
            if (own[c.nameField] === overwrite && typeof own[c.idField] === 'string')
              await endpoints
                .sendTo(
                  c.deleteId,
                  { body: { [c.idField]: own[c.idField] } },
                  {
                    label: `profile-idor:cleanup-c-${c.label}`,
                    auth: { principal: C },
                    allowLiveWrite: true,
                  },
                )
                .catch(() => undefined);

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
          // A always deletes its own record (a delete of one already gone only answers a failure),
          // logging in again if A's session was lost, so nothing is left on the profile.
          await restoreStep(endpoints, A, () =>
            endpoints.sendTo(
              c.deleteId,
              { body: { [c.idField]: recordId } },
              {
                label: `profile-idor:cleanup-${c.label}`,
                auth: { principal: A },
                allowLiveWrite: true,
              },
            ),
          ).catch(() => undefined);
        }
      });
    }
  },
);
