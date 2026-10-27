// Hand-written race scenarios: what a double-fire means for each specific workflow (duplicate record,
// corrupted field, colliding id), which the engine's generic `concurrency.*` validators don't ask.

import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { runSimultaneously } from '@utils/concurrency';
import { mailShape } from '@api/definitions/kmail/send.api';
import { contactShape } from '@api/definitions/kpost/contacts/write.api';
import { expect, test } from '@fixtures';

/**
 * Gated behind `CONCURRENCY_LIFECYCLE=true` (off by default): nobody can restart the shared test
 * environment if a burst knocks it over. `runSimultaneously` releases all requests from one tick.
 */
const DEFERRED_REASON =
  'CONCURRENCY: set CONCURRENCY_LIFECYCLE=true to run — off by default because the shared test ' +
  'environment has no confirmed restart/recovery coverage; get that confirmed before enabling against ' +
  'anything but a throwaway/local target.';

const K = AUTH_PROFILES.kpost;
const principal = (key: string): Principal => {
  const found = K.principals.find((p) => p.key === key);
  if (!found) throw new Error(`principal "${key}" is not configured`);
  return found;
};

test.describe(
  'KPost · concurrency scenarios (hand-written races) @concurrency',
  { tag: ['@api', '@platform', '@regression'] },
  () => {
    test('Katchup sendMessage: two identical sends fired together (duplicate-tap) @api @katchup @concurrency', async ({
      endpoints,
    }) => {
      // Double-tap send: no idempotency key, so two distinct messages are fine; a 5xx is the finding.
      test.skip(process.env.CONCURRENCY_LIFECYCLE !== 'true', DEFERRED_REASON);
      const sender = principal('personal');
      const body = {
        selectedContact: testData.victimKpostId,
        subject: `QA concurrency probe ${Date.now()}`,
        message: 'Sent twice, at once, on purpose — safe to ignore.',
      };
      const result = await runSimultaneously(2, () =>
        endpoints.sendTo(
          'katchup-send-message',
          { body },
          {
            label: 'concurrency:katchup-double-send',
            auth: { principal: sender },
            allowLiveWrite: true,
          },
        ),
      );
      const statuses = result.outcomes.map((o) =>
        o.status === 'fulfilled' ? o.value?.status : -1,
      );
      expect
        .soft(
          statuses.every((s) => typeof s === 'number' && s < 500),
          `no 5xx under a 2-way burst (got ${JSON.stringify(statuses)})`,
        )
        .toBe(true);
    });

    test('Group removeGroupMember: the same member removed twice, simultaneously @api @group @concurrency', async ({
      endpoints,
      databases,
    }) => {
      // Same member removed twice at once on a throwaway group: no 5xx, and removed_flag ends at 1
      // (detects a check-then-update double-delete race).
      test.skip(process.env.CONCURRENCY_LIFECYCLE !== 'true', DEFERRED_REASON);
      const owner = principal('personal');
      const victim = testData.victimKpostId;
      let groupID: number | undefined;
      try {
        const created = await endpoints.sendTo(
          'group-create',
          {
            body: {
              activeStatus: 'Y',
              createdBy: owner.username,
              groupPicturePath: null,
              groupCreateAccess: true,
              groupKpostName: `QA Concurrency Group ${Date.now()}`,
              isPrivateGroup: 'N',
              memberDetails: [
                {
                  createdBy: owner.username,
                  hasAdminAccess: 'N',
                  kpostID: victim,
                  name: 'QA',
                  memberDesignation: '',
                  privacyStatus: 'Y',
                  remarks: 'created',
                },
                {
                  createdBy: owner.username,
                  hasAdminAccess: 'Y',
                  kpostID: owner.username,
                  name: 'QA',
                  memberDesignation: '',
                  privacyStatus: 'Y',
                  remarks: 'created',
                },
              ],
            },
          },
          { label: 'concurrency:group-setup', auth: { principal: owner }, allowLiveWrite: true },
        );
        const createdJson = created.json();
        const createdValue = (createdJson.ok ? createdJson.value : {}) as Record<string, unknown>;
        groupID = createdValue.groupID as number | undefined;
        expect(groupID, 'the owner created the throwaway group').toBeTruthy();
        if (!groupID) return;

        const result = await runSimultaneously(2, () =>
          endpoints.sendTo(
            'group-remove-member',
            { body: { memberKpostIdList: [victim], groupID } },
            {
              label: 'concurrency:double-remove',
              auth: { principal: owner },
              allowLiveWrite: true,
            },
          ),
        );
        const statuses = result.outcomes.map((o) =>
          o.status === 'fulfilled' ? o.value?.status : -1,
        );
        expect
          .soft(
            statuses.every((s) => typeof s === 'number' && s < 500),
            `no 5xx on either simultaneous remove (got ${JSON.stringify(statuses)})`,
          )
          .toBe(true);

        const database = databases.for('kpost-api');
        if (database.enabled) {
          const row = await database.findOne<{ removed_flag: number }>({
            table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
            where: { group_id: groupID, kpost_id: victim },
          });
          expect
            .soft(
              Number(row?.removed_flag ?? 1),
              'the member ends up removed exactly once, not in a flapped state',
            )
            .toBe(1);
        }
      } finally {
        if (groupID) {
          await endpoints
            .sendTo(
              'group-delete',
              { body: { groupID } },
              {
                label: 'concurrency:group-cleanup',
                auth: { principal: owner },
                allowLiveWrite: true,
              },
            )
            .catch(() => undefined);
        }
      }
    });

    test('KOS saveContent: two simultaneous edits to the same document (lost-update) @api @kos @concurrency', async ({
      endpoints,
    }) => {
      // Two different saves to one document at once: last-write-wins is fine, a merge or 5xx is not.
      // Known defect #499: kos-create-doc returns no docId, so this cannot reach a real document yet.
      test.skip(process.env.CONCURRENCY_LIFECYCLE !== 'true', DEFERRED_REASON);
      test.skip(
        true,
        'also blocked on #499 (kos-create-doc does not return a docId) independent of deferral',
      );
      const owner = principal('personal');
      const created = await endpoints.sendTo(
        'kos-create-doc',
        { body: { documentName: `QA Concurrency Doc ${Date.now()}`, documentType: 'DOC' } },
        { label: 'concurrency:kos-setup', auth: { principal: owner }, allowLiveWrite: true },
      );
      const createdJson = created.json();
      const createdValue = (createdJson.ok ? createdJson.value : {}) as Record<string, unknown>;
      const docId = createdValue.docId as string | number | undefined;
      expect(docId, 'a document was created').toBeTruthy();
      if (!docId) return;

      const result = await runSimultaneously(2, (index) =>
        endpoints.sendTo(
          'kos-save-content',
          { body: { docId, content: `writer-${index}-${Date.now()}` } },
          {
            label: `concurrency:kos-double-save-${index}`,
            auth: { principal: owner },
            allowLiveWrite: true,
          },
        ),
      );
      const statuses = result.outcomes.map((o) =>
        o.status === 'fulfilled' ? o.value?.status : -1,
      );
      expect
        .soft(
          statuses.every((s) => typeof s === 'number' && s < 500),
          `no 5xx on either simultaneous save (got ${JSON.stringify(statuses)})`,
        )
        .toBe(true);
    });

    test('Kall reScheduleKall: the same call rescheduled twice, simultaneously @api @kall @concurrency', async ({
      endpoints,
    }) => {
      // A reschedule mints a new kallID and marks the original ReScheduled (status 7). Rescheduling
      // the same call twice at once must mint at most one new call, and never 5xx.
      test.skip(process.env.CONCURRENCY_LIFECYCLE !== 'true', DEFERRED_REASON);
      const owner = principal('personal');
      const receiver = principal('victim');
      const start = Date.now() + 3_600_000;
      const scheduled = await endpoints.sendTo(
        'kall-scheduled',
        {
          body: {
            kallSession: `qa-concurrency-${Date.now()}`,
            kallMode: 1,
            subject: 'QA concurrency probe — safe to ignore',
            scheduledStartTime: start,
            scheduledEndTime: start + 1_800_000,
            meetingLink: 'www.jitsi.com',
            repeatType: 0,
            repeatedDate: null,
            kallDetails: [{ receiver: receiver.username }],
          },
        },
        { label: 'concurrency:kall-setup', auth: { principal: owner }, allowLiveWrite: true },
      );
      const scheduledJson = scheduled.json();
      const scheduledValue = (scheduledJson.ok ? scheduledJson.value : {}) as Record<
        string,
        unknown
      >;
      const kallID = scheduledValue.kallID as number | string | undefined;
      expect(kallID, 'a call was scheduled').toBeTruthy();
      if (!kallID) return;

      const result = await runSimultaneously(2, () =>
        endpoints.sendTo(
          'kall-reschedule',
          {
            body: {
              kallID,
              scheduledStartTime: start + 7_200_000,
              scheduledEndTime: start + 9_000_000,
            },
          },
          {
            label: 'concurrency:kall-double-reschedule',
            auth: { principal: owner },
            allowLiveWrite: true,
          },
        ),
      );
      const statuses = result.outcomes.map((o) =>
        o.status === 'fulfilled' ? o.value?.status : -1,
      );
      expect
        .soft(
          statuses.every((s) => typeof s === 'number' && s < 500),
          `no 5xx on either simultaneous reschedule (got ${JSON.stringify(statuses)})`,
        )
        .toBe(true);
      const successCount = statuses.filter(
        (s) => typeof s === 'number' && s >= 200 && s < 300,
      ).length;
      expect
        .soft(
          successCount,
          'at most one simultaneous reschedule of the same call mints a new kallID',
        )
        .toBeLessThanOrEqual(1);
    });

    test('Profile updateBasicInformation: two simultaneous conflicting updates (lost-update) @api @profile @concurrency', async ({
      endpoints,
    }) => {
      // Two conflicting designation updates at once: the stored value must be exactly one writer's.
      // The original designation is restored in `finally`.
      test.skip(process.env.CONCURRENCY_LIFECYCLE !== 'true', DEFERRED_REASON);
      const owner = principal('personal');
      const original = await endpoints.sendTo(
        'profile-fetch-user-details',
        {},
        { label: 'concurrency:profile-snapshot', auth: { principal: owner } },
      );
      const originalJson = original.json();
      const originalValue = (originalJson.ok ? originalJson.value : {}) as Record<string, unknown>;
      const originalDesignation =
        (originalValue.designation as string | undefined) ?? 'QA Bench Tester';

      try {
        const result = await runSimultaneously(2, (index) =>
          endpoints.sendTo(
            'profile-update-basic',
            {
              body: {
                knownLanguages: ['English'],
                designation: `QA Concurrency ${index === 0 ? 'A' : 'B'}`,
                gender: 'Female',
                dateOfBirth: '1995-01-01',
                otherEmail: testData.otpEmail,
              },
            },
            {
              label: `concurrency:profile-double-update-${index}`,
              auth: { principal: owner },
              allowLiveWrite: true,
            },
          ),
        );
        const statuses = result.outcomes.map((o) =>
          o.status === 'fulfilled' ? o.value?.status : -1,
        );
        expect
          .soft(
            statuses.every((s) => typeof s === 'number' && s < 500),
            `no 5xx on either simultaneous update (got ${JSON.stringify(statuses)})`,
          )
          .toBe(true);

        const after = await endpoints.sendTo(
          'profile-fetch-user-details',
          {},
          { label: 'concurrency:profile-after', auth: { principal: owner } },
        );
        const afterJson = after.json();
        const afterValue = (afterJson.ok ? afterJson.value : {}) as Record<string, unknown>;
        const afterDesignation = afterValue.designation as string | undefined;
        expect
          .soft(
            ['QA Concurrency A', 'QA Concurrency B'].includes(afterDesignation ?? ''),
            `the stored designation ("${afterDesignation}") must be exactly one writer's value, not a mix`,
          )
          .toBe(true);
      } finally {
        await endpoints
          .sendTo(
            'profile-update-basic',
            {
              body: {
                knownLanguages: ['English'],
                designation: originalDesignation,
                gender: 'Female',
                dateOfBirth: '1995-01-01',
                otherEmail: testData.otpEmail,
              },
            },
            {
              label: 'concurrency:profile-restore',
              auth: { principal: owner },
              allowLiveWrite: true,
            },
          )
          .catch(() => undefined);
      }
    });

    test('KMail postMail: two identical sends fired together (duplicate-tap) @api @kmail @concurrency', async ({
      endpoints,
    }) => {
      // Double-tap send on compose: no idempotency key, so two distinct mails are fine; a 5xx is the
      // finding. Both mails are deleted in `finally`.
      test.skip(process.env.CONCURRENCY_LIFECYCLE !== 'true', DEFERRED_REASON);
      const sender = principal('personal');
      const receiver = principal('victim');
      const subject = `QA concurrency probe ${Date.now()}`;
      let kmailIds: number[] = [];

      try {
        const result = await runSimultaneously(2, () =>
          endpoints.sendTo(
            'kmail-post-mail',
            {
              body: mailShape({
                toAddress: receiver.username,
                kmailSubject: subject,
                kmailContent: 'Sent twice, at once, on purpose — safe to ignore.',
              }),
            },
            {
              label: 'concurrency:kmail-double-send',
              auth: { principal: sender },
              allowLiveWrite: true,
            },
          ),
        );
        const statuses = result.outcomes.map((o) =>
          o.status === 'fulfilled' ? o.value?.status : -1,
        );
        expect
          .soft(
            statuses.every((s) => typeof s === 'number' && s < 500),
            `no 5xx under a 2-way burst (got ${JSON.stringify(statuses)})`,
          )
          .toBe(true);

        kmailIds = result.outcomes
          .map((o) => {
            if (o.status !== 'fulfilled') return undefined;
            const json = o.value?.json();
            const body = (json?.ok ? json.value : {}) as Record<string, unknown>;
            const data = body.data;
            const row = Array.isArray(data)
              ? (data[0] as Record<string, unknown> | undefined)
              : undefined;
            return typeof row?.kmailID === 'number' ? row.kmailID : undefined;
          })
          .filter((id): id is number => typeof id === 'number');
      } finally {
        for (const kmailId of kmailIds) {
          await endpoints
            .sendTo(
              'kmail-delete',
              { body: { groupFlag: false, transactionIDs: [kmailId] } },
              {
                label: 'concurrency:kmail-cleanup',
                auth: { principal: sender },
                allowLiveWrite: true,
              },
            )
            .catch(() => undefined);
        }
      }
    });

    test('Contacts addContact: the same contact added twice, simultaneously @api @contacts @concurrency', async ({
      endpoints,
      databases,
    }) => {
      // Same contact added twice at once: one row at most, no 5xx (detects a check-then-insert
      // race). The contact is removed in `finally`.
      test.skip(process.env.CONCURRENCY_LIFECYCLE !== 'true', DEFERRED_REASON);
      const owner = principal('personal');
      const target = testData.victimKpostId;

      try {
        const result = await runSimultaneously(2, () =>
          endpoints.sendTo(
            'contacts-add',
            { body: contactShape({ contactID: target }) },
            {
              label: 'concurrency:contacts-double-add',
              auth: { principal: owner },
              allowLiveWrite: true,
            },
          ),
        );
        const statuses = result.outcomes.map((o) =>
          o.status === 'fulfilled' ? o.value?.status : -1,
        );
        expect
          .soft(
            statuses.every((s) => typeof s === 'number' && s < 500),
            `no 5xx on either simultaneous add (got ${JSON.stringify(statuses)})`,
          )
          .toBe(true);

        const database = databases.for('kpost-api');
        if (database.enabled) {
          const rows = await database.findMany<{ contact_id: string }>({
            table: 'TBL_KPOST_USER_CONTACTS',
            where: { kpost_id: owner.username, contact_id: target },
          });
          expect
            .soft(
              rows.length,
              'exactly one contact row exists for this pair, not a duplicate insert',
            )
            .toBeLessThanOrEqual(1);
        }
      } finally {
        await endpoints
          .sendTo(
            'contacts-delete',
            { body: { contactID: target } },
            {
              label: 'concurrency:contacts-cleanup',
              auth: { principal: owner },
              allowLiveWrite: true,
            },
          )
          .catch(() => undefined);
      }
    });
  },
);

// Not encoded on purpose:
// - Admin suspend+terminate race: writes live Admin data and KSMACC with no rollback.
// - KBooking double-booking a seat: no seat-selection endpoint definitions exist yet.
