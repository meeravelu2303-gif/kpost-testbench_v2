import { AUTH_PROFILES } from '@config/auth-profile';
import { initiateShape } from '@api/definitions/kpost/kall/direct.api';
import { scheduleShape } from '@api/definitions/kpost/kall/schedule.api';
import { KALL_STATUS } from '@api/contract/kpost-types';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Kall · what the SERVER records for each way a call can go — answered, declined, missed, and a
 * Kool Kall joined — read back from the call log (`kallInfo`), the record both apps show.
 *
 * Driven through the API as the two people involved (A = qatest1 calls, B = qatest2 answers), exactly
 * as the web client does (`InComingKall.handleUpdateKall`, `GlobalKallSender.endIndividualKall`):
 *   initiateKall → updateKallStatus {id: B's row id, kallStatus, kallID, reason} → endIndividualKall.
 * Status codes are the workbook's (`KALL_STATUS`): connected 1, declined 4, noresponse 3, closed 8.
 * Accepting stamps kallStartTime on both rows; ending stamps kallEndTime and kallDuration
 * (KallDaoImplV3.updateConnectedKallStatus / endIndividualKall).
 *
 * The media side of a call (ringing on screen, audio) is `journeys/voice-call.spec.ts`, blocked by #1680
 * (the callee is never rung); everything here is the server's record, which does not depend on it.
 * Every call is ended in `finally`: an open call (status 0/1) leaves the account "On Another Call".
 */
/** The workbook's Kall status codes this file uses; a missing label fails here, not in a check. */
function code(label: string): number {
  const value = KALL_STATUS[label];
  if (value === undefined)
    throw new Error(`KALL_STATUS has no '${label}' — did the contract workbook change?`);
  return value;
}
const S = {
  new: code('new'),
  connected: code('connected'),
  declined: code('declined'),
  noresponse: code('noresponse'),
  closed: code('closed'),
};
const P = AUTH_PROFILES.kpost.principals;
const A = P.find((p) => p.key === 'personal')!;
const B = P.find((p) => p.key === 'victim')!;

interface CallRow {
  id?: number;
  receiver?: string;
  receiverKallStatus?: number;
  kallStartTime?: string | null;
  kallEndTime?: string | null;
  kallDuration?: string | null;
  reason?: string | null;
  joinStatus?: boolean;
}
interface Call {
  kallID?: number;
  senderKallStatus?: number;
  kallStartTime?: string | null;
  kallEndTime?: string | null;
  kallDuration?: string | null;
  senderJoinStatus?: number;
  kallDetails?: CallRow[];
}

const dataOf = (bodyText: string): unknown =>
  (JSON.parse(bodyText || '{}') as { data?: unknown }).data;

/** A rings B; returns the call id and B's row id (the id every answer must carry). */
async function ring(endpoints: EndpointExecutor): Promise<{ kallID: number; rowId: number }> {
  const placed = await endpoints.sendTo(
    'kall-initiate',
    { body: initiateShape({ receiver: B.username }) },
    { label: 'call-states:ring', auth: { principal: A }, allowLiveWrite: true },
  );
  expect(placed.status, 'A places the call').toBe(200);
  const call = dataOf(placed.bodyText) as Call;
  const rowId = call.kallDetails?.[0]?.id;
  expect(call.kallID, 'the call has an id').toBeTruthy();
  expect(rowId, "B's row has an id").toBeTruthy();
  expect(call.kallDetails?.[0]?.receiverKallStatus, 'B is ringing (new)').toBe(S.new);
  return { kallID: Number(call.kallID), rowId: Number(rowId) };
}

/** B answers the ringing call with a status (and reason), as the incoming-call card does. */
function answer(
  endpoints: EndpointExecutor,
  kallID: number,
  rowId: number,
  kallStatus: number,
  reason = '',
) {
  return endpoints.sendTo(
    'kall-update-status',
    { body: { id: rowId, kallStatus, kallID, reason } },
    { label: `call-states:answer-${kallStatus}`, auth: { principal: B }, allowLiveWrite: true },
  );
}

/** The call as `who` sees it in their call log with `contact`. */
async function logEntry(
  endpoints: EndpointExecutor,
  who: typeof A,
  contact: string,
  kallID: number,
): Promise<Call | undefined> {
  const info = await endpoints.sendTo(
    'kall-info',
    { body: { contactID: contact, kallID: null } },
    { label: `call-states:log-${who.key}`, auth: { principal: who } },
  );
  expect(info.status, `${who.key}'s call log reads`).toBe(200);
  const rows = (dataOf(info.bodyText) as Call[] | undefined) ?? [];
  return rows.find((c) => c.kallID === kallID);
}

/** End a call that may still be open, so no account is left "busy". Best-effort. */
async function hangUp(endpoints: EndpointExecutor, kallID: number | undefined): Promise<void> {
  if (!kallID) return;
  await endpoints
    .sendTo(
      'kall-end-individual',
      { body: { kallID } },
      { label: 'call-states:hang-up', auth: { principal: A }, allowLiveWrite: true },
    )
    .catch(() => undefined);
}

test.describe(
  'KPost Kall · the server records how each call went',
  { tag: ['@api', '@kall', '@regression'] },
  () => {
    test.skip(
      process.env.KALL_LIFECYCLE !== 'true',
      'places real calls between the QA accounts; set KALL_LIFECYCLE=true',
    );

    test(
      'an answered call records its start, end and duration on both sides, and shows in the log',
      {
        tag: '@sanity',
        annotation: [
          { type: 'requirement', description: 'FR-KL-009' },
          { type: 'requirement', description: 'RTM-KALL-A05' },
          // The server half of the connected call; ringing on screen is voice-call.spec.ts (#1680).
          { type: 'requirement-partial', description: 'RTM-KALL-A01' },
        ],
      },
      async ({ endpoints }) => {
        let kallID: number | undefined;
        try {
          const call = await ring(endpoints);
          kallID = call.kallID;

          const accepted = await answer(endpoints, call.kallID, call.rowId, S.connected);
          expect(accepted.status, 'B accepts').toBe(200);
          const live = (dataOf(accepted.bodyText) as Call[])[0];
          expect(live?.senderKallStatus, "A's side is connected").toBe(S.connected);
          expect(live?.kallDetails?.[0]?.receiverKallStatus, "B's side is connected").toBe(
            S.connected,
          );
          expect(live?.kallStartTime, "the call's start time is recorded").toBeTruthy();
          expect(live?.kallDetails?.[0]?.kallStartTime, "B's start time is recorded").toBeTruthy();

          // Talk for a couple of seconds so the duration is measurable (deliberate, not a wait-for).
          await new Promise((r) => setTimeout(r, 2_500));

          const ended = await endpoints.sendTo(
            'kall-end-individual',
            { body: { kallID } },
            { label: 'call-states:end', auth: { principal: A }, allowLiveWrite: true },
          );
          expect(ended.status, 'A hangs up').toBe(200);

          const seenByA = await logEntry(endpoints, A, B.username, call.kallID);
          expect(seenByA, "the call is in A's log").toBeTruthy();
          const row = seenByA?.kallDetails?.[0];
          expect(seenByA?.senderKallStatus, 'closed for A').toBe(S.closed);
          expect(row?.receiverKallStatus, 'closed for B').toBe(S.closed);
          const start = Date.parse(String(seenByA?.kallStartTime));
          const end = Date.parse(String(seenByA?.kallEndTime));
          expect(
            Number.isFinite(start) && Number.isFinite(end),
            'start and end are timestamps',
          ).toBe(true);
          expect(
            end - start,
            'the end is after the start, by about the talk time',
          ).toBeGreaterThanOrEqual(1_000);
          expect(seenByA?.kallDuration, 'the duration is recorded as hh:mm:ss').toMatch(
            /^\d{2}:\d{2}:\d{2}$/,
          );
          expect(seenByA?.kallDuration, 'and is not zero').not.toBe('00:00:00');
          expect(row?.kallEndTime, "B's end time is recorded").toBeTruthy();

          const seenByB = await logEntry(endpoints, B, A.username, call.kallID);
          expect(seenByB, "the same call is in B's log").toBeTruthy();
          kallID = undefined; // ended
        } finally {
          await hangUp(endpoints, kallID);
        }
      },
    );

    test(
      'a declined call is recorded as declined, and never as started',
      { annotation: [{ type: 'requirement', description: 'RTM-KALL-A02' }] },
      async ({ endpoints }) => {
        let kallID: number | undefined;
        try {
          const call = await ring(endpoints);
          kallID = call.kallID;
          // Exactly what the web Reject button sends (InComingKall.rejectCall → handleUpdateKall(4)).
          const declined = await answer(endpoints, call.kallID, call.rowId, S.declined);
          expect(
            declined.status,
            'B declines — the server saves it (#13206: 404 Kall not found)',
          ).toBe(200);

          const seenByA = await logEntry(endpoints, A, B.username, call.kallID);
          const row = seenByA?.kallDetails?.[0];
          expect(row?.receiverKallStatus, "A's log shows B declined").toBe(S.declined);
          expect(row?.kallStartTime ?? null, 'a declined call never started').toBeNull();
        } finally {
          await hangUp(endpoints, kallID);
        }
      },
    );

    test(
      'an unanswered call is recorded as missed in both logs, and never as started',
      { annotation: [{ type: 'requirement', description: 'RTM-KALL-A03' }] },
      async ({ endpoints }) => {
        let kallID: number | undefined;
        try {
          const call = await ring(endpoints);
          kallID = call.kallID;
          // What the incoming-call card sends when nobody answers within 30 s (InComingKall
          // NO_RESPONSE_TIMEOUT → UpdateKall(3)).
          const missed = await answer(endpoints, call.kallID, call.rowId, S.noresponse);
          expect(missed.status, 'the no-answer is saved (#13206: 404 Kall not found)').toBe(200);

          for (const [who, contact] of [
            [A, B.username],
            [B, A.username],
          ] as const) {
            const seen = await logEntry(endpoints, who, contact, call.kallID);
            expect(seen, `the call is in ${who.key}'s log`).toBeTruthy();
            expect(seen?.kallDetails?.[0]?.receiverKallStatus, `${who.key} sees it as missed`).toBe(
              S.noresponse,
            );
            expect(seen?.kallStartTime ?? null, 'a missed call never started').toBeNull();
          }
        } finally {
          await hangUp(endpoints, kallID);
        }
      },
    );

    test(
      'joining a Kool Kall records each participant as joined, with their start time',
      { annotation: [{ type: 'requirement', description: 'RTM-KALL-A06' }] },
      async ({ endpoints }) => {
        let kallID: number | undefined;
        let rowId: number | undefined;
        try {
          const scheduled = await endpoints.sendTo(
            'kall-scheduled',
            {
              body: scheduleShape({
                subject: `QA Kool Kall join ${Date.now()}`,
                kallDetails: [{ receiver: B.username }],
              }),
            },
            { label: 'call-states:schedule', auth: { principal: A }, allowLiveWrite: true },
          );
          expect(scheduled.status, 'A schedules a Kool Kall with B').toBeLessThan(300);
          const meeting = ([] as Call[]).concat(dataOf(scheduled.bodyText) as Call | Call[])[0];
          kallID = meeting?.kallID;
          rowId = meeting?.kallDetails?.[0]?.id;
          expect(kallID, 'the meeting has an id').toBeTruthy();
          expect(rowId, "B's invitation has an id").toBeTruthy();

          const hostJoined = await endpoints.sendTo(
            'kall-join-schedule',
            { body: { id: 0, kallID } },
            { label: 'call-states:join-host', auth: { principal: A }, allowLiveWrite: true },
          );
          expect(hostJoined.status, 'A (the host) joins').toBe(200);
          const guestJoined = await endpoints.sendTo(
            'kall-join-schedule',
            { body: { id: rowId, kallID } },
            { label: 'call-states:join-guest', auth: { principal: B }, allowLiveWrite: true },
          );
          expect(guestJoined.status, 'B joins').toBe(200);

          const seen = await logEntry(endpoints, A, B.username, Number(kallID));
          expect(seen, "the meeting is in A's log").toBeTruthy();
          expect(seen?.senderJoinStatus, 'A is recorded as joined').toBe(1);
          expect(seen?.kallStartTime, "A's join time is recorded").toBeTruthy();
          const guest = seen?.kallDetails?.find((d) => d.receiver === B.username);
          expect(guest?.joinStatus, 'B is recorded as joined').toBe(true);
          expect(guest?.kallStartTime, "B's join time is recorded").toBeTruthy();
          expect(guest?.receiverKallStatus, 'B is connected').toBe(S.connected);
        } finally {
          if (kallID) {
            // The host ends the meeting; B closes their own row (the invitee is not covered by
            // the host's end — KallDaoImplV3.endKall), or B would stay "On Another Call" (#1679).
            await endpoints
              .sendTo(
                'kall-end-kool',
                { body: { kallID } },
                {
                  label: 'call-states:end-kool',
                  auth: { principal: A },
                  allowLiveWrite: true,
                },
              )
              .catch(() => undefined);
            if (rowId)
              await endpoints
                .sendTo(
                  'kall-end-kool',
                  { body: { id: rowId, kallID } },
                  {
                    label: 'call-states:end-kool-guest',
                    auth: { principal: B },
                    allowLiveWrite: true,
                  },
                )
                .catch(() => undefined);
          }
        }
      },
    );
  },
);
