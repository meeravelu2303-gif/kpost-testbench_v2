// Business-specific concurrency/race-condition scenarios, hand-written on top of the engine's generic
// `concurrency.*` validators (read-consistency, burst-resilience, duplicate-write, session-isolation —
// see src/validators/concurrency/, permanently blocked on any production-labelled target by
// PRODUCTION_BLOCKED_VALIDATORS in src/validation-engine/production-validators.ts). Those four are
// endpoint-agnostic; the scenarios below encode what a SPECIFIC double-fire actually means for each
// workflow (does a second simultaneous call create a duplicate record, corrupt a shared field, or
// collide on an id?) — a question the generic probes don't ask.
/* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect */
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { runSimultaneously } from '@utils/concurrency';
import { expect, test } from '@fixtures';

/**
 * CONCURRENCY — WRITTEN, EXECUTION DEFERRED.
 *
 * Every test in this file is fully implemented (built on the same `runSimultaneously` barrier
 * dispatcher the engine's own concurrency validators use — tasks are constructed first and released
 * together from one tick, so the race genuinely reproduces instead of degrading into two sequential
 * calls) but is UNCONDITIONALLY skipped, independent of any env flag. This is a deliberate, temporary
 * restriction: the shared test environment currently has no one available to restart/recover it if a
 * burst of simultaneous writes knocks it over, so firing any of these for real is deferred until that
 * changes. See `TEST_BENCH_100_PERCENT_PLAN.md` §"Concurrency — written, execution deferred" for the
 * full catalog, including scenarios not yet encoded here. To re-enable a specific test once recovery
 * capability exists, delete its `test.skip(true, ...)` line — nothing else needs to change.
 */
const DEFERRED_REASON =
  'CONCURRENCY — WRITTEN, EXECUTION DEFERRED: shared test environment has no restart/recovery ' +
  'coverage right now; do not fire simultaneous-write bursts until that changes.';

const K = AUTH_PROFILES.kpost;
const principal = (key: string): Principal => {
  const found = K.principals.find((p) => p.key === key);
  if (!found) throw new Error(`principal "${key}" is not configured`);
  return found;
};

test.describe('KPost · concurrency scenarios (hand-written races) @concurrency', () => {
  test(
    'Katchup sendMessage: two identical sends fired together (duplicate-tap) @api @katchup @concurrency',
    async ({ endpoints }) => {
      /*
       * Scenario: a user double-taps "send" (or a flaky client retries) before the first response
       * returns, firing the exact same message body twice, simultaneously.
       * Endpoint: katchup-send-message (POST /v2/katchup/sendMessage/).
       * Test data: 2 identical bodies (same subject/text/receiver), from the same sender, to the
       * victim test account — fully disposable, no production data involved.
       * Requests: 2, dispatched from the same tick via runSimultaneously(2, ...).
       * Expected behavior (TO BE CONFIRMED against the product owner, not assumed here): the app has
       * no idempotency key on this endpoint, so the most defensible expectation is that BOTH sends
       * succeed and create TWO distinct messages (msg_id differs) — not that the server silently
       * dedupes one, and CRITICALLY not that either response is a 5xx. A 5xx under concurrent load
       * on a plain two-request burst would itself be the finding.
       * Race condition this detects: a write path that isn't safe under two simultaneous callers
       * (e.g. a non-atomic read-modify-write on a per-conversation counter) crashing or corrupting
       * state instead of just creating two ordinary messages.
       */
      test.skip(true, DEFERRED_REASON);
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
          { label: 'concurrency:katchup-double-send', auth: { principal: sender }, allowLiveWrite: true },
        ),
      );
      const statuses = result.outcomes.map((o) => (o.status === 'fulfilled' ? o.value?.status : -1));
      expect
        .soft(statuses.every((s) => typeof s === 'number' && s < 500), `no 5xx under a 2-way burst (got ${JSON.stringify(statuses)})`)
        .toBe(true);
    },
  );

  test(
    'Group removeGroupMember: the same member removed twice, simultaneously @api @group @concurrency',
    async ({ endpoints, databases }) => {
      /*
       * Scenario: two admins (or one admin's double-tap) call removeGroupMember for the SAME member
       * of the SAME group at the same instant.
       * Endpoint: group-remove-member (POST /v2/group/removeGroupMember/).
       * Test data: a throwaway group created by this test, with the victim account as a plain member.
       * Requests: 2, identical body { memberKpostIdList: [victim], groupID }, both from the group owner.
       * Expected behavior: exactly one call's effect lands (removed_flag -> 1, confirmed numeric per
       * the 2026-10-02 flag-encoding fix in security/object-authorization.spec.ts); the OTHER call
       * must answer something sane (a clean no-op 2xx or a 4xx "already removed"), never a 5xx, and
       * the database must never end up in an inconsistent state (e.g. removed_flag flapping, or two
       * audit rows disagreeing about who removed whom).
       * Race condition this detects: a non-atomic "check membership exists, then update" pattern
       * racing with itself — the classic double-delete TOCTOU bug.
       */
      test.skip(true, DEFERRED_REASON);
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
                { createdBy: owner.username, hasAdminAccess: 'N', kpostID: victim, name: 'QA', memberDesignation: '', privacyStatus: 'Y', remarks: 'created' },
                { createdBy: owner.username, hasAdminAccess: 'Y', kpostID: owner.username, name: 'QA', memberDesignation: '', privacyStatus: 'Y', remarks: 'created' },
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
            { label: 'concurrency:double-remove', auth: { principal: owner }, allowLiveWrite: true },
          ),
        );
        const statuses = result.outcomes.map((o) => (o.status === 'fulfilled' ? o.value?.status : -1));
        expect
          .soft(statuses.every((s) => typeof s === 'number' && s < 500), `no 5xx on either simultaneous remove (got ${JSON.stringify(statuses)})`)
          .toBe(true);

        const database = databases.for('kpost-api');
        if (database.enabled) {
          const row = await database.findOne<{ removed_flag: number }>({
            table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
            where: { group_id: groupID, kpost_id: victim },
          });
          expect
            .soft(Number(row?.removed_flag ?? 1), 'the member ends up removed exactly once, not in a flapped state')
            .toBe(1);
        }
      } finally {
        if (groupID) {
          await endpoints
            .sendTo('group-delete', { body: { groupID } }, { label: 'concurrency:group-cleanup', auth: { principal: owner }, allowLiveWrite: true })
            .catch(() => undefined);
        }
      }
    },
  );

  test(
    'KOS saveContent: two simultaneous edits to the same document (lost-update) @api @kos @concurrency',
    async ({ endpoints }) => {
      /*
       * Scenario: two collaborators (or one client's duplicate autosave tick) call saveContent for
       * the SAME docId at the same instant with DIFFERENT content.
       * Endpoint: kos-save-content (needs a real docId from kos-create-doc).
       * BLOCKER NOTE: kos-create-doc is currently broken live (#499 — does not return a docId), so
       * this scenario cannot even reach a real document today regardless of the concurrency
       * restriction. Written against the day #499 is fixed; until then it would skip on that
       * dependency even with the deferred-execution skip removed.
       * Test data: one throwaway document created by this test; two distinct content payloads, one
       * per simultaneous request, so a lost-update is distinguishable (we know which one "should"
       * have been overwritten by whichever actually landed last).
       * Requests: 2, dispatched together.
       * Expected behavior: the document ends up with ONE of the two payloads (last-write-wins is
       * acceptable), never a corrupted merge of both, never a 5xx, and a subsequent read returns
       * content matching exactly one of the two writers — not silently losing the write that "won"
       * at the HTTP layer while persisting the other at the DB layer (a response/state mismatch).
       * Race condition this detects: a non-atomic read-modify-write on the document body letting two
       * writers silently clobber each other into an inconsistent response-vs-stored-state pair.
       */
      test.skip(true, DEFERRED_REASON);
      test.skip(true, 'also blocked on #499 (kos-create-doc does not return a docId) independent of deferral');
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
          { label: `concurrency:kos-double-save-${index}`, auth: { principal: owner }, allowLiveWrite: true },
        ),
      );
      const statuses = result.outcomes.map((o) => (o.status === 'fulfilled' ? o.value?.status : -1));
      expect
        .soft(statuses.every((s) => typeof s === 'number' && s < 500), `no 5xx on either simultaneous save (got ${JSON.stringify(statuses)})`)
        .toBe(true);
    },
  );

  test(
    'Kall reScheduleKall: the same call rescheduled twice, simultaneously @api @kall @concurrency',
    async ({ endpoints }) => {
      /*
       * Scenario: two simultaneous reschedule calls on the SAME kallID (e.g. a double-tap on
       * "reschedule" in the UI before the first response returns).
       * Endpoint: kall-reschedule (POST /v2/kall/reScheduleKall). Per the 2026-09-26 finding
       * (API-COVERAGE-DEPTH.md), a reschedule is EXPECTED to mint a brand-new kallID each time and
       * flip the original's senderKallStatus 6 (Scheduled) -> 7 (ReScheduled) — this is confirmed
       * correct product behavior, not a bug, so the concurrency question here is narrower: what
       * happens when the SAME original kallID is rescheduled twice before either completes?
       * Test data: one throwaway scheduled call created by this test.
       * Requests: 2, identical body { kallID }, dispatched together.
       * Expected behavior: at most one of the two calls should succeed in moving the original to
       * ReScheduled and minting a new kallID; the other should see the original already
       * ReScheduled and be refused cleanly (4xx) or report the same new kallID (idempotent-looking),
       * never both succeeding and minting TWO new kallIDs from one original, and never a 5xx.
       * Race condition this detects: two reschedules racing to read-then-write the original's status,
       * both seeing "still Scheduled" and both minting a new call from the same original.
       */
      test.skip(true, DEFERRED_REASON);
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
      const scheduledValue = (scheduledJson.ok ? scheduledJson.value : {}) as Record<string, unknown>;
      const kallID = scheduledValue.kallID as number | string | undefined;
      expect(kallID, 'a call was scheduled').toBeTruthy();
      if (!kallID) return;

      const result = await runSimultaneously(2, () =>
        endpoints.sendTo(
          'kall-reschedule',
          { body: { kallID, scheduledStartTime: start + 7_200_000, scheduledEndTime: start + 9_000_000 } },
          { label: 'concurrency:kall-double-reschedule', auth: { principal: owner }, allowLiveWrite: true },
        ),
      );
      const statuses = result.outcomes.map((o) => (o.status === 'fulfilled' ? o.value?.status : -1));
      expect
        .soft(statuses.every((s) => typeof s === 'number' && s < 500), `no 5xx on either simultaneous reschedule (got ${JSON.stringify(statuses)})`)
        .toBe(true);
      const successCount = statuses.filter((s) => typeof s === 'number' && s >= 200 && s < 300).length;
      expect
        .soft(successCount, 'at most one simultaneous reschedule of the same call mints a new kallID')
        .toBeLessThanOrEqual(1);
    },
  );

  test(
    'Profile updateBasicInformation: two simultaneous conflicting updates (lost-update) @api @profile @concurrency',
    async ({ endpoints }) => {
      /*
       * Scenario: two simultaneous profile updates from the SAME account with DIFFERENT values for
       * the same field (e.g. two open tabs, or a retry racing the original request).
       * Endpoint: profile-update-basic (POST /v2/profile/updateBasicInformation/).
       * Test data: two bodies identical except `designation` ("QA Concurrency A" vs "QA Concurrency
       * B"), on the bench's own primary account — restored to its original value in `finally`.
       * Requests: 2, dispatched together.
       * Expected behavior: the account ends up with EXACTLY ONE of the two designations (never a
       * corrupted mix of both requests' fields), neither response is a 5xx, and a follow-up read
       * matches whichever response claimed success last — not a response/stored-state mismatch.
       * Race condition this detects: a non-atomic field-level update letting two simultaneous writers
       * interleave and leave the row in a state neither caller actually requested.
       */
      test.skip(true, DEFERRED_REASON);
      const owner = principal('personal');
      const original = await endpoints.sendTo(
        'profile-fetch-user-details',
        {},
        { label: 'concurrency:profile-snapshot', auth: { principal: owner } },
      );
      const originalJson = original.json();
      const originalValue = (originalJson.ok ? originalJson.value : {}) as Record<string, unknown>;
      const originalDesignation = (originalValue.designation as string | undefined) ?? 'QA Bench Tester';

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
            { label: `concurrency:profile-double-update-${index}`, auth: { principal: owner }, allowLiveWrite: true },
          ),
        );
        const statuses = result.outcomes.map((o) => (o.status === 'fulfilled' ? o.value?.status : -1));
        expect
          .soft(statuses.every((s) => typeof s === 'number' && s < 500), `no 5xx on either simultaneous update (got ${JSON.stringify(statuses)})`)
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
            { label: 'concurrency:profile-restore', auth: { principal: owner }, allowLiveWrite: true },
          )
          .catch(() => undefined);
      }
    },
  );
});

/**
 * Catalog entries applicable but NOT YET encoded as runnable (even skipped) tests, with the reason:
 *
 * - Admin `rolePosting/suspendOrTerminateEmployee` (admin-role-posting-suspend-terminate): a
 *   concurrent suspend+terminate race on the same employee is a real, high-value scenario — but this
 *   endpoint writes to LIVE PRODUCTION data (Admin's database is live, not a test instance) and fans
 *   out to two external systems (the core KPost backend's `/admin/holdOrRelease/` and, on terminate,
 *   KSMACC at `apigateway.ksmacc.in`) with no visible compensating rollback between them. Writing even
 *   a permanently-skipped test against this endpoint risks someone later removing the skip without
 *   fully appreciating the blast radius. Deferred until a disposable "expendable" employee record and
 *   explicit owner sign-off exist for this specific scenario — tracked in
 *   TEST_BENCH_100_PERCENT_PLAN.md rather than half-implemented here.
 * - KBooking seat/order concurrency (two simultaneous attempts to hold the same seat): applicable in
 *   principle (classic double-booking race), but no KBooking endpoint definitions exist in the bench
 *   yet (search/seat-selection API coverage is itself still TODO, independent of concurrency). Revisit
 *   once the non-payment KBooking API surface is built.
 * - KMail send duplicate-tap: structurally identical to the Katchup scenario above, deferred to avoid
 *   writing it against a module whose write-lifecycle flows (KMAIL_LIFECYCLE) are still being
 *   reconciled after the 2026-10-02 auth-regression fix — revisit once that settles.
 */
