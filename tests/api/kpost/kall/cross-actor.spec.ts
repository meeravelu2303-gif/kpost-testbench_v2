import { scheduleShape } from '@api/definitions/kpost/kall/schedule.api';
import type { Principal } from '@config/auth.config';
import { env } from '@config/env';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { describeViews, observeAs, rowsOf } from '../../support/cross-actor';
import { slotPrincipals, type CleanupCoordinator } from '../../../../src/test-data/index';

/**
 * Caller → call participant, observed through each actor's own session (master plan §10,
 * requirement 4).
 *
 * ## What is testable without a second WebRTC peer, and what is not
 *
 * A call cannot CONNECT headlessly: `kall.connected` needs a second WebRTC peer, which this
 * environment has no way to provide. That is an environment limitation and never an application
 * defect, so nothing here fakes a connection or forces the transition.
 *
 * Everything before connection is real and testable, and it is the part that matters for actor
 * visibility: a scheduled call is a record with participants, and the participant either sees it in
 * their own dashboard or they do not. `feature.spec.ts` schedules calls and adds members entirely as
 * the CALLER; it never asks the participant whether the invitation reached them.
 *
 *     caller       A   schedules a call naming B
 *     participant  B   must see that call in their OWN Kool Kall list
 *
 * Correlated on `kallID`, never on the subject.
 *
 * ## Blocked, recorded rather than worked around
 *
 * `kall.connected`, and therefore the call-log transitions FR-KL-008/009 (participants, role/team,
 * duration, exact start and end), need a completed call. They stay unsupported by this execution
 * environment until a second peer exists; the invariant catalogue records them as TO_DO with that
 * reason.
 */

const [CALLER, PARTICIPANT] = slotPrincipals(2) as [Principal, Principal];

/** The kallID from a create response, across the shapes the API uses. */
function kallIdOf(body: Record<string, unknown>): number | undefined {
  const data = body.data;
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  const object =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : undefined;
  for (const candidate of [object?.kallID, object?.id, row?.kallID, row?.id, body.kallID]) {
    if (typeof candidate === 'number') return candidate;
  }
  return undefined;
}

test.describe('KPost Kall · cross-actor scheduling', { tag: '@kpost-api' }, () => {
  test.describe.configure({ mode: 'default' });
  test.skip(!env.KALL_LIFECYCLE, 'schedules a real call; set KALL_LIFECYCLE=true');

  test('a scheduled call reaches the participant’s OWN call list (FR-KL-001 / FR-KL-002) @api @kall', async ({
    endpoints,
    resources,
  }: {
    endpoints: EndpointExecutor;
    resources: CleanupCoordinator;
  }, testInfo) => {
    const subject = `QA XActor kall ${Date.now()}`;

    const scheduled = await endpoints.sendTo(
      'kall-scheduled',
      { body: scheduleShape({ subject, kallDetails: [{ receiver: PARTICIPANT.username }] }) },
      { label: 'kall-xactor:schedule', auth: { principal: CALLER }, allowLiveWrite: true },
    );
    const parsed = scheduled.json();
    const kallID = kallIdOf((parsed.ok ? parsed.value : {}) as Record<string, unknown>);
    expect(
      typeof kallID,
      `scheduling must be accepted and issue a kallID (status ${String(scheduled.status)})`,
    ).toBe('number');

    /*
     * Registered as soon as the identity exists. Cleanup clears the caller's OWN history — a GET with
     * no body, so there is no id for the QA-identifier guard to weigh, and it removes anything a
     * failed step left behind rather than only the one call.
     */
    resources.track({
      kind: 'kall',
      id: String(kallID),
      describe: `cross-actor scheduled call "${subject}"`,
      cleanup: async () => {
        const cleared = await endpoints.sendTo(
          'kall-clear-history',
          {},
          {
            label: 'kall-xactor:cleanup',
            auth: { principal: CALLER },
            allowLiveWrite: true,
            phase: 'cleanup',
          },
        );
        return `cleared caller history (${String(cleared.status)})`;
      },
    });

    // ---- each actor reads their OWN scheduled-call list ----------------------------------------
    const callerView = await observeAs(endpoints, {
      role: 'call-caller',
      as: CALLER,
      endpointId: 'kall-today-kool',
      label: 'kall-xactor:caller-list',
      observationId: 'kall.status-via-today-kool',
    });
    const participantView = await observeAs(endpoints, {
      role: 'call-participant',
      as: PARTICIPANT,
      endpointId: 'kall-today-kool',
      label: 'kall-xactor:participant-list',
      observationId: 'kall.status-via-today-kool',
    });
    await testInfo.attach('actor-views', {
      body: [
        ...describeViews([callerView, participantView]),
        '',
        'BLOCKED by this execution environment: kall.connected needs a second WebRTC peer, so the',
        'call-log transitions (FR-KL-008/009) cannot be reached headlessly. Nothing here fakes one.',
      ].join('\n'),
      contentType: 'text/plain',
    });

    const holdsCall = (view: typeof callerView): boolean =>
      rowsOf(view.body).some((row) => row.kallID === kallID);

    expect(
      holdsCall(callerView),
      `the caller must see the call they scheduled (kallID ${String(kallID)})`,
    ).toBe(true);
    expect(
      holdsCall(participantView),
      `the PARTICIPANT must see the call they were invited to, in their own session (kallID ` +
        `${String(kallID)}). The caller's view saying the schedule succeeded is a different fact.`,
    ).toBe(true);
  });
});
