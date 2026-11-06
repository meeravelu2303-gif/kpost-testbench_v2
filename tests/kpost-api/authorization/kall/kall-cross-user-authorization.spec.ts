import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { scheduleShape } from '@api/definitions/kpost/kall/schedule.api';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Cross-user authorization on a scheduled (Kool) Kall, by kallID in the body. Organiser A schedules
 * a call with participant B; C, who has no part in it, names its kallID. Each probe has an owner
 * control (the organiser's or participant's identical call works) and is judged by A's own read-back
 * (`getKallStatusUsingKallID`), never by the status code alone. Everything made is ended and cleared
 * in `finally`.
 *
 * `kallDashboard` and `kallInfo` take the kallID as a paging cursor and are meant to filter every row
 * by the caller's token (KallControllerV3.java:745, 817; KallDaoImplV3.java:534-544, 695-713); the
 * last test proves that live: the outsider's history never lists the pair's call.
 */
const P = AUTH_PROFILES.kpost.principals;
const A = P.find((p) => p.key === 'personal'); // organiser
const B = P.find((p) => p.key === 'victim'); // participant
const C = P.find((p) => p.key === 'personal-3'); // outsider
const D = P.find((p) => p.key === 'personal-4'); // second participant (member probes only)
const stamp = Date.now();

type Json = Record<string, unknown>;

interface Member {
  id?: number;
  receiver: string;
  joinStatus?: boolean;
}
interface KallSnapshot {
  senderKallStatus?: number;
  senderJoinStatus?: number;
  members: Member[];
}

const same = (a: string | undefined, b: string | undefined): boolean =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

function valueOf(text: string): Json {
  try {
    const parsed: unknown = JSON.parse(text || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Json) : {};
  } catch {
    return {};
  }
}

/** The kallID a schedule answered with (`data[0].kallID`, or the other shapes the API uses). */
function kallIdIn(body: Json): number | undefined {
  const data = body.data;
  const row = Array.isArray(data) ? (data[0] as Json | undefined) : undefined;
  const obj = data && typeof data === 'object' && !Array.isArray(data) ? (data as Json) : undefined;
  for (const candidate of [obj?.kallID, obj?.id, row?.kallID, row?.id, body.kallID]) {
    if (typeof candidate === 'number') return candidate;
  }
  return undefined;
}

/** Whether a response hands back the given call (its id or its unique subject). */
function discloses(text: string, kallID: number, subject: string): boolean {
  if (text.includes(subject)) return true;
  const data = valueOf(text).data;
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Json[];
  return rows.some((row) => row?.kallID === kallID);
}

async function schedule(
  endpoints: EndpointExecutor,
  label: string,
  subject: string,
  receivers: Principal[],
): Promise<number | undefined> {
  const ex = await endpoints.sendTo(
    'kall-scheduled',
    {
      body: scheduleShape({
        subject,
        kallDetails: receivers.map((r) => ({ receiver: r.username })),
      }),
    },
    { label: `kall-xuser:${label}:schedule`, auth: { principal: A! }, allowLiveWrite: true },
  );
  return ex.status < 300 ? kallIdIn(valueOf(ex.bodyText)) : undefined;
}

/** The organiser's own read of the call: its status and members. */
async function ownerRead(
  endpoints: EndpointExecutor,
  label: string,
  kallID: number,
): Promise<KallSnapshot | undefined> {
  const ex = await endpoints.sendTo(
    'kall-get-status-by-id',
    { body: { kpostID: A!.username, kallID } },
    { label: `kall-xuser:${label}`, auth: { principal: A! }, allowLiveWrite: true },
  );
  if (ex.status >= 300) return undefined;
  const data = valueOf(ex.bodyText).data;
  const row = (Array.isArray(data) ? data[0] : data) as Json | undefined;
  if (!row || row.kallID !== kallID) return undefined;
  const details = (Array.isArray(row.kallDetails) ? row.kallDetails : []) as Json[];
  return {
    senderKallStatus: typeof row.senderKallStatus === 'number' ? row.senderKallStatus : undefined,
    senderJoinStatus: typeof row.senderJoinStatus === 'number' ? row.senderJoinStatus : undefined,
    members: details.map((d) => ({
      id: typeof d.id === 'number' ? d.id : undefined,
      receiver: typeof d.receiver === 'string' ? d.receiver : '',
      joinStatus: typeof d.joinStatus === 'boolean' ? d.joinStatus : undefined,
    })),
  };
}

const memberOf = (snap: KallSnapshot | undefined, who: Principal): Member | undefined =>
  snap?.members.find((m) => same(m.receiver, who.username));

/** The organiser ends each call (kallID only: adding `id` makes endKoolKall 500), then all clear it. */
async function cleanUp(endpoints: EndpointExecutor, kallIDs: number[]): Promise<void> {
  for (const kallID of kallIDs) {
    await endpoints
      .sendTo(
        'kall-end-kool',
        { body: { kallID } },
        { label: 'kall-xuser:cleanup-end', auth: { principal: A! }, allowLiveWrite: true },
      )
      .catch(() => undefined);
    for (const who of [A, B, C, D]) {
      if (!who) continue;
      await endpoints
        .sendTo(
          'kall-clear-by-ids',
          { body: { kallIds: [kallID] } },
          {
            label: `kall-xuser:cleanup-clear:${who.key}`,
            auth: { principal: who },
            allowLiveWrite: true,
          },
        )
        .catch(() => undefined);
    }
  }
}

test.describe(
  'KPost Security · a scheduled Kall cannot be read or changed by someone not on it (IDOR/BOLA) @api @kpost-api @security @kall',
  {
    tag: ['@api', '@kall', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.describe.configure({ mode: 'default', timeout: 120_000 });
    test.skip(
      !A || !B || !C,
      'needs three distinct KPost principals (personal, victim, personal-3)',
    );
    test.skip(
      process.env.KALL_LIFECYCLE !== 'true',
      'schedules real calls; set KALL_LIFECYCLE=true',
    );

    test('an outsider cannot read a scheduled call by its kallID (getKallStatusUsingKallID) @api @kpost-api @security', async ({
      endpoints,
    }) => {
      const subject = `QA xuser status-by-id ${stamp}`;
      const made: number[] = [];
      try {
        const kallID = await schedule(endpoints, 'status-by-id', subject, [B!]);
        test.skip(!kallID, 'the call could not be scheduled right now, so nothing to probe');
        made.push(kallID!);

        // Owner control: the organiser's identical read returns the call.
        const control = await endpoints.sendTo(
          'kall-get-status-by-id',
          { body: { kpostID: A!.username, kallID } },
          { label: 'kall-xuser:status-by-id:owner', auth: { principal: A! }, allowLiveWrite: true },
        );
        test.skip(
          control.status >= 300 || !discloses(control.bodyText, kallID!, subject),
          `owner control: the organiser's own read of call ${kallID} failed (HTTP ${control.status}), so a refusal proves nothing`,
        );

        // The body's kpostID is what the client sends; the outsider names the organiser there too.
        for (const [variant, kpostID] of [
          ['spoofed kpostID', A!.username],
          ['own kpostID', C!.username],
        ] as const) {
          const body = { kpostID, kallID };
          const attack = await endpoints.sendTo(
            'kall-get-status-by-id',
            { body },
            {
              label: `kall-xuser:status-by-id:outsider:${variant.replace(/\W+/g, '-')}`,
              auth: { principal: C! },
              allowLiveWrite: true,
              ownedIdentifiers: [kallID!, A!.username],
            },
          );
          const leaked = attack.status < 300 && discloses(attack.bodyText, kallID!, subject);
          if (leaked)
            endpoints.recordBusinessRuleViolation({
              endpointId: 'kall-get-status-by-id',
              ruleId: 'IDOR-kall-status-by-id-disclosure',
              rule:
                'Only the organiser or a participant of a call may read it by kallID; an account ' +
                'with no part in the call must get nothing back.',
              expected: `HTTP 404 (or 403) and no call data for ${C!.username}`,
              actual:
                `HTTP ${attack.status} (${variant}): ${C!.username} read call ${kallID} ` +
                `(${A!.username} → ${B!.username}): ${attack.bodyText.slice(0, 300)}`,
              request: { body },
              correlationId: attack.correlationId,
            });
          expect
            .soft(
              leaked,
              `an outsider must not read call ${kallID} by its id (${variant}, HTTP ${attack.status})`,
            )
            .toBe(false);
        }
      } finally {
        await cleanUp(endpoints, made);
      }
    });

    test('an outsider cannot add themselves to, or remove a member from, a scheduled call (modifyKallMembers) @api @kpost-api @security', async ({
      endpoints,
    }) => {
      test.skip(
        !D || D.username.includes('qa.p4'),
        'needs QA_PERSONAL_4_KPOST_ID as a second participant (a call cannot lose its last member)',
      );
      const subject = `QA xuser members ${stamp}`;
      const made: number[] = [];
      let violated = false;
      try {
        // Two participants, so a removal of B is not refused merely for leaving the call empty.
        const kallID = await schedule(endpoints, 'members', subject, [B!, D!]);
        test.skip(!kallID, 'the call could not be scheduled right now, so nothing to probe');
        made.push(kallID!);
        const before = await ownerRead(endpoints, 'members:before', kallID!);
        test.skip(
          !memberOf(before, B!) || !memberOf(before, D!) || !!memberOf(before, C!),
          `owner control: the organiser's read of call ${kallID} does not show exactly B and D as members`,
        );

        const outsider = {
          auth: { principal: C! },
          allowLiveWrite: true,
          ownedIdentifiers: [kallID!, C!.username, B!.username],
        };

        // 1. The outsider adds themselves.
        const addBody = { kallID, addingUserIds: [C!.username], removingUserIds: [] as string[] };
        const add = await endpoints.sendTo(
          'kall-modify-members',
          { body: addBody },
          { label: 'kall-xuser:members:outsider-add', ...outsider },
        );
        const afterAdd = await ownerRead(endpoints, 'members:after-add', kallID!);
        const added = !!memberOf(afterAdd, C!);
        if (added) {
          violated = true;
          endpoints.recordBusinessRuleViolation({
            endpointId: 'kall-modify-members',
            ruleId: 'IDOR-kall-modify-members-outsider-add',
            rule: 'Only the organiser of a scheduled call may add members to it.',
            expected: `the request is refused and ${C!.username} is not a member of call ${kallID}`,
            actual: `HTTP ${add.status}: ${C!.username} added themselves to call ${kallID} (${A!.username} → ${B!.username}, ${D!.username})`,
            request: { body: addBody },
            correlationId: add.correlationId,
          });
        }
        expect
          .soft(added, `an outsider must not add themselves to call ${kallID} (HTTP ${add.status})`)
          .toBe(false);

        // 2. The outsider removes a participant.
        const removeBody = {
          kallID,
          addingUserIds: [] as string[],
          removingUserIds: [B!.username],
        };
        const remove = await endpoints.sendTo(
          'kall-modify-members',
          { body: removeBody },
          { label: 'kall-xuser:members:outsider-remove', ...outsider },
        );
        const afterRemove = await ownerRead(endpoints, 'members:after-remove', kallID!);
        const removed = !!afterRemove && !memberOf(afterRemove, B!);
        if (removed) {
          violated = true;
          endpoints.recordBusinessRuleViolation({
            endpointId: 'kall-modify-members',
            ruleId: 'IDOR-kall-modify-members-outsider-remove',
            rule: 'Only the organiser of a scheduled call may remove members from it.',
            expected: `the request is refused and ${B!.username} is still a member of call ${kallID}`,
            actual: `HTTP ${remove.status}: ${C!.username} removed ${B!.username} from call ${kallID} (organiser ${A!.username})`,
            request: { body: removeBody },
            correlationId: remove.correlationId,
          });
        }
        expect
          .soft(
            removed,
            `an outsider must not remove a participant from call ${kallID} (HTTP ${remove.status})`,
          )
          .toBe(false);

        // Owner control: the organiser's identical two calls work, so the refusals above mean something.
        const ownerAdd = await endpoints.sendTo(
          'kall-modify-members',
          { body: addBody },
          { label: 'kall-xuser:members:owner-add', auth: { principal: A! }, allowLiveWrite: true },
        );
        const controlAdd = ownerAdd.status;
        const ownerRemove = await endpoints.sendTo(
          'kall-modify-members',
          { body: removeBody },
          {
            label: 'kall-xuser:members:owner-remove',
            auth: { principal: A! },
            allowLiveWrite: true,
          },
        );
        const controlRemove = ownerRemove.status;
        const afterOwner = await ownerRead(endpoints, 'members:after-owner', kallID!);
        const controlWorked = !!memberOf(afterOwner, C!) && !memberOf(afterOwner, B!);
        test.info().annotations.push({
          type: 'owner-control',
          description: `organiser add HTTP ${controlAdd}, remove HTTP ${controlRemove}; read-back ${controlWorked ? 'shows both changes' : 'does NOT show both changes'}`,
        });
        if (!violated)
          test.skip(
            !controlWorked,
            `owner control: the organiser's identical add/remove did not take effect (HTTP ${controlAdd}/${controlRemove}), so the outsider's refusal proves nothing`,
          );
      } finally {
        await cleanUp(endpoints, made);
      }
    });

    test('an outsider cannot end a scheduled call they are not on (endKoolKall) @api @kpost-api @security', async ({
      endpoints,
    }) => {
      const subject = `QA xuser end-kool ${stamp}`;
      const made: number[] = [];
      try {
        const kallID = await schedule(endpoints, 'end-kool', subject, [B!]);
        test.skip(!kallID, 'the call could not be scheduled right now, so nothing to probe');
        made.push(kallID!);
        const before = await ownerRead(endpoints, 'end-kool:before', kallID!);
        test.skip(
          before?.senderKallStatus === undefined || before.senderKallStatus === 8,
          `owner control: the organiser cannot read call ${kallID} as open, so the probe proves nothing`,
        );

        // kallID only, as the client sends it (adding `id` makes endKoolKall answer 500).
        const body = { kallID };
        const attack = await endpoints.sendTo(
          'kall-end-kool',
          { body },
          {
            label: 'kall-xuser:end-kool:outsider',
            auth: { principal: C! },
            allowLiveWrite: true,
            ownedIdentifiers: [kallID!],
          },
        );
        const after = await ownerRead(endpoints, 'end-kool:after-outsider', kallID!);
        const ended =
          after?.senderKallStatus !== undefined &&
          after.senderKallStatus !== before!.senderKallStatus;
        if (ended)
          endpoints.recordBusinessRuleViolation({
            endpointId: 'kall-end-kool',
            ruleId: 'IDOR-kall-end-kool-by-outsider',
            rule: 'Only the organiser of a scheduled call may end it.',
            expected: `the request is refused and call ${kallID} keeps status ${before!.senderKallStatus}`,
            actual: `HTTP ${attack.status}: ${C!.username} moved call ${kallID} (${A!.username} → ${B!.username}) from status ${before!.senderKallStatus} to ${after.senderKallStatus}`,
            request: { body },
            correlationId: attack.correlationId,
          });
        expect
          .soft(
            ended,
            `an outsider must not end call ${kallID} (HTTP ${attack.status}, status ${before!.senderKallStatus} → ${after?.senderKallStatus})`,
          )
          .toBe(false);

        // Owner control: the organiser's identical call ends it (8 = ended).
        const own = await endpoints.sendTo(
          'kall-end-kool',
          { body },
          { label: 'kall-xuser:end-kool:owner', auth: { principal: A! }, allowLiveWrite: true },
        );
        const afterOwner = await ownerRead(endpoints, 'end-kool:after-owner', kallID!);
        if (!ended)
          test.skip(
            afterOwner?.senderKallStatus !== 8,
            `owner control: the organiser's identical end did not close call ${kallID} (HTTP ${own.status}, status ${afterOwner?.senderKallStatus}), so the refusal proves nothing`,
          );
      } finally {
        await cleanUp(endpoints, made);
      }
    });

    /**
     * joinScheduleKall updates either the master row (id 0: `kallID AND sender = me`) or one
     * participant row (`id AND receiver = me`), then answers with the master row read by the body's
     * kallID alone (KallDaoImplV3.java:114-133). Three outsider probes: join as organiser, join with
     * the participant's row id, and join one's OWN row on another call while naming this call's id.
     */
    test('an outsider cannot join, or read through join, a scheduled call they are not on (joinScheduleKall) @api @kpost-api @security', async ({
      endpoints,
    }) => {
      const subject = `QA xuser join ${stamp}`;
      const decoySubject = `QA xuser join-decoy ${stamp}`;
      const made: number[] = [];
      let violated = false;
      try {
        const kallID = await schedule(endpoints, 'join', subject, [B!]);
        test.skip(!kallID, 'the call could not be scheduled right now, so nothing to probe');
        made.push(kallID!);
        // A second call of A's on which C IS a participant, so C owns a real participant row.
        const decoyID = await schedule(endpoints, 'join-decoy', decoySubject, [C!]);
        if (decoyID) made.push(decoyID);

        const before = await ownerRead(endpoints, 'join:before', kallID!);
        const bRow = memberOf(before, B!);
        test.skip(
          !bRow?.id || before?.senderJoinStatus === undefined,
          `owner control: the organiser's read of call ${kallID} does not show B's participant row`,
        );
        const decoy = decoyID ? await ownerRead(endpoints, 'join:decoy', decoyID) : undefined;
        const cRow = memberOf(decoy, C!);

        const outsider = (ids: (string | number)[]) => ({
          auth: { principal: C! },
          allowLiveWrite: true,
          ownedIdentifiers: [kallID!, ...ids],
        });

        // 1. As organiser (id 0 → the master row).
        const asOrganiser = { id: 0, kallID };
        const a1 = await endpoints.sendTo(
          'kall-join-schedule',
          { body: asOrganiser },
          { label: 'kall-xuser:join:outsider-as-organiser', ...outsider([]) },
        );
        // 2. With B's participant row id.
        const asParticipant = { id: bRow!.id, kallID };
        const a2 = await endpoints.sendTo(
          'kall-join-schedule',
          { body: asParticipant },
          { label: 'kall-xuser:join:outsider-as-participant', ...outsider([bRow!.id!]) },
        );
        const after = await ownerRead(endpoints, 'join:after-outsider', kallID!);
        test.skip(
          !after,
          `the organiser could not read call ${kallID} back after the probes (not re-checked)`,
        );
        const masterChanged =
          after?.senderJoinStatus !== before!.senderJoinStatus ||
          after?.senderKallStatus !== before!.senderKallStatus;
        const bChanged = memberOf(after, B!)?.joinStatus !== bRow!.joinStatus;
        const leakedBy1or2 = [a1, a2].some(
          (ex) => ex.status < 300 && discloses(ex.bodyText, kallID!, subject),
        );
        if (masterChanged || bChanged || leakedBy1or2) {
          violated = true;
          endpoints.recordBusinessRuleViolation({
            endpointId: 'kall-join-schedule',
            ruleId: 'IDOR-kall-join-by-outsider',
            rule:
              'Only the organiser or a participant of a scheduled call may join it; an outsider ' +
              "must not change the call's join state or get the call back.",
            expected: `both requests refused; call ${kallID} and B's row unchanged; no call data returned`,
            actual:
              `as organiser HTTP ${a1.status}, with B's row id HTTP ${a2.status}; master ` +
              `joinStatus ${before!.senderJoinStatus}→${after?.senderJoinStatus}, status ` +
              `${before!.senderKallStatus}→${after?.senderKallStatus}; B's row joinStatus ` +
              `${bRow!.joinStatus}→${memberOf(after, B!)?.joinStatus}; call data returned=${leakedBy1or2}`,
            request: { body: asParticipant },
            correlationId: a2.correlationId,
          });
        }
        expect
          .soft(
            masterChanged,
            `an outsider must not join call ${kallID} as its organiser (HTTP ${a1.status})`,
          )
          .toBe(false);
        expect
          .soft(bChanged, `an outsider must not join call ${kallID} on B's row (HTTP ${a2.status})`)
          .toBe(false);
        expect.soft(leakedBy1or2, `an outsider's join must not return call ${kallID}`).toBe(false);

        // 3. C joins their OWN row on the decoy call but names this call's kallID.
        if (cRow?.id) {
          const crossed = { id: cRow.id, kallID };
          const a3 = await endpoints.sendTo(
            'kall-join-schedule',
            { body: crossed },
            { label: 'kall-xuser:join:outsider-own-row', ...outsider([cRow.id, decoyID!]) },
          );
          const leaked = a3.status < 300 && discloses(a3.bodyText, kallID!, subject);
          if (leaked) {
            violated = true;
            endpoints.recordBusinessRuleViolation({
              endpointId: 'kall-join-schedule',
              ruleId: 'IDOR-kall-join-cross-call-disclosure',
              rule:
                "joinScheduleKall must answer with the call the caller's participant row belongs " +
                "to; naming another call's kallID must not return that call to someone not on it.",
              expected: `no data of call ${kallID} returned to ${C!.username}`,
              actual:
                `HTTP ${a3.status}: ${C!.username} sent their own row ${cRow.id} (call ${decoyID}) ` +
                `with kallID ${kallID} and got call ${kallID} (${A!.username} → ${B!.username}) back: ` +
                a3.bodyText.slice(0, 300),
              request: { body: crossed },
              correlationId: a3.correlationId,
            });
          }
          expect
            .soft(
              leaked,
              `joining one's own row on call ${decoyID} while naming call ${kallID} must not return call ${kallID} (HTTP ${a3.status})`,
            )
            .toBe(false);
        } else {
          test.info().annotations.push({
            type: 'skipped-probe',
            description: `own-row probe not run: no participant row for ${C!.username} on a decoy call (decoy kallID ${decoyID ?? 'not created'})`,
          });
        }

        // Owner control: the participant's identical call joins and returns the call.
        const own = await endpoints.sendTo(
          'kall-join-schedule',
          { body: asParticipant },
          { label: 'kall-xuser:join:participant', auth: { principal: B! }, allowLiveWrite: true },
        );
        const afterOwn = await ownerRead(endpoints, 'join:after-participant', kallID!);
        const controlWorked =
          own.status < 300 &&
          discloses(own.bodyText, kallID!, subject) &&
          memberOf(afterOwn, B!)?.joinStatus === true;
        if (!violated)
          test.skip(
            !controlWorked,
            `owner control: B's identical join did not take effect (HTTP ${own.status}), so the outsider's refusals prove nothing`,
          );
      } finally {
        await cleanUp(endpoints, made);
      }
    });

    test("an outsider's call history never lists another pair's call (kallDashboard, kallInfo) @api @kpost-api @security", async ({
      endpoints,
    }) => {
      // Both take a kallID paging cursor (rows below it) and are meant to be filtered by the caller's
      // token (KallDaoImplV3.java:534-544, 695-713). Proven here: the outsider pages from just above
      // A's call, and names B and A as the contact, and must never see the call.
      const subject = `QA xuser history ${stamp}`;
      const made: number[] = [];
      try {
        const kallID = await schedule(endpoints, 'history', subject, [B!]);
        test.skip(!kallID, 'the call could not be scheduled right now, so nothing to probe');
        made.push(kallID!);
        const cursor = kallID! + 1;
        const history = (
          id: 'kall-dashboard' | 'kall-info',
          who: Principal,
          body: Json,
          label: string,
        ) =>
          endpoints.sendTo(
            id,
            { body },
            {
              label: `kall-xuser:history:${label}`,
              auth: { principal: who },
              allowLiveRead: true,
              ownedIdentifiers: [kallID!],
            },
          );

        // Owner controls: the organiser's own dashboard and its history with B both list the call.
        const ownDashboard = await history(
          'kall-dashboard',
          A!,
          { kallID: cursor },
          'owner-dashboard',
        );
        const ownInfo = await history(
          'kall-info',
          A!,
          { contactID: B!.username, kallID: cursor },
          'owner-info',
        );
        const dashboardControl =
          ownDashboard.status < 300 && discloses(ownDashboard.bodyText, kallID!, subject);
        const infoControl = ownInfo.status < 300 && discloses(ownInfo.bodyText, kallID!, subject);
        test.skip(
          !dashboardControl && !infoControl,
          `owner control: neither kallDashboard (HTTP ${ownDashboard.status}) nor kallInfo (HTTP ${ownInfo.status}) lists A's own scheduled call ${kallID}, so the outsider's empty answer proves nothing`,
        );

        const probes: Array<[string, 'kall-dashboard' | 'kall-info', Json, boolean]> = [
          [
            'dashboard from the same cursor',
            'kall-dashboard',
            { kallID: cursor },
            dashboardControl,
          ],
          [
            'info naming the participant',
            'kall-info',
            { contactID: B!.username, kallID: cursor },
            infoControl,
          ],
          [
            'info naming the organiser',
            'kall-info',
            { contactID: A!.username, kallID: cursor },
            infoControl,
          ],
        ];
        for (const [variant, id, body, controlled] of probes) {
          if (!controlled) {
            test.info().annotations.push({
              type: 'not-judged',
              description: `${id} (${variant}): the owner's own call did not list the call`,
            });
            continue;
          }
          const attack = await history(id, C!, body, `outsider:${variant.replace(/\W+/g, '-')}`);
          const leaked = attack.status < 300 && discloses(attack.bodyText, kallID!, subject);
          if (leaked)
            endpoints.recordBusinessRuleViolation({
              endpointId: id,
              ruleId: `IDOR-${id}-foreign-call-in-history`,
              rule: "A user's call history lists only calls they organised or were invited to.",
              expected: `no row for call ${kallID} in ${C!.username}'s answer`,
              actual: `HTTP ${attack.status} (${variant}): ${C!.username}'s ${id} listed call ${kallID} (${A!.username} → ${B!.username})`,
              request: { body },
              correlationId: attack.correlationId,
            });
          expect
            .soft(leaked, `an outsider's ${id} must not list call ${kallID} (${variant})`)
            .toBe(false);
        }
      } finally {
        await cleanUp(endpoints, made);
      }
    });
  },
);
