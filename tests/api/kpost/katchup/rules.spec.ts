import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { KATCHUP_MESSAGE_TYPE } from '@api/schemas/kpost-types';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Katchup rules asserted by their END RESULT, as each party sees it in their thread
 * (`katchupMessagesForSelectedContactID`) — not merely "the request was accepted".
 *
 * What the app actually does (traced from source 2026-10-20, KatchupControllerV2 / KatchupServiceImpl /
 * KatchupDaoImpl, KatchupMessage.js):
 * - Disappearing (messageType 18): never deleted from the DB; the thread fetch drops it for BOTH parties
 *   once `isVanished && readTime != null` (after-read) or `secretMessageExpireTime < now` (schedule). The
 *   recipient's FIRST open still returns it (the rows load before the read-update), so it is gone from
 *   the next fetch on. #976 (filed: "never actually disappear") was resolved FIXED 2026-10-05.
 * - Hidden-source forward (bulk, messageType 16): the server replaces the source with an anonymous
 *   replica, so the recipient's row must not carry the original sender anywhere.
 * - Reminder: a normal message of type 3 that points at the original (no date/time; nothing scheduled).
 * - Save: keeps the selected messages and hides every OTHER message of that conversation — for the
 *   caller only (the confirm text says so: "Only the selected message will be saved, the rest will be
 *   deleted"); the other party's view is untouched. Run on qatest3 → qatest4, a pair no other spec
 *   converses on, because it hides qatest3's older messages with qatest4.
 */
const P = AUTH_PROFILES.kpost.principals;
const who = (key: string): Principal => P.find((p) => p.key === key)!;
const A = who('personal');
const B = who('victim');
const C = who('personal-3');
const D = who('personal-4');

function code(label: string): number {
  const value = KATCHUP_MESSAGE_TYPE[label];
  if (value === undefined) throw new Error(`KATCHUP_MESSAGE_TYPE has no '${label}'`);
  return value;
}
const SECRET = code('secretMessage');
const REMINDER = code('reminderMessage');
const HIDDEN_FORWARD = code('forwardMessageHidden');

interface Row {
  msgID?: number;
  sender?: string;
  messageType?: number;
  actualMessage?: string;
  referenceMessage?: string | null;
  referenceMessageIDList?: number[] | null;
}
interface Thread {
  rows: Row[];
  text: string;
  deleted: number[];
}

async function send(
  endpoints: EndpointExecutor,
  as: Principal,
  overrides: Record<string, unknown>,
): Promise<number> {
  const exchange = await endpoints.sendTo(
    'katchup-send-message',
    { body: sendShape(overrides) },
    { label: `rules:send:${as.key}`, auth: { principal: as }, allowLiveWrite: true },
  );
  expect(exchange.status, `${as.key} sends`).toBeLessThan(300);
  const id = (JSON.parse(exchange.bodyText) as { data?: Array<{ msgID?: number }> }).data?.[0]
    ?.msgID;
  expect(id, 'the message is stored').toBeTruthy();
  return Number(id);
}

async function thread(endpoints: EndpointExecutor, as: Principal, withId: string): Promise<Thread> {
  const exchange = await endpoints.sendTo(
    'katchup-conversation',
    { body: { groupFlag: false, firstMsgID: null, lastMsgID: null, receiver: withId } },
    { label: `rules:thread:${as.key}`, auth: { principal: as } },
  );
  expect(exchange.status, `${as.key}'s thread reads`).toBe(200);
  const body = JSON.parse(exchange.bodyText || '{}') as { data?: Row[]; deleted_msgIDs?: number[] };
  return { rows: body.data ?? [], text: exchange.bodyText, deleted: body.deleted_msgIDs ?? [] };
}

const has = (t: Thread, id: number) => t.rows.some((r) => r.msgID === id);

async function remove(endpoints: EndpointExecutor, as: Principal, ids: Array<number | undefined>) {
  const messageIds = ids.filter((i): i is number => typeof i === 'number');
  if (!messageIds.length) return;
  await endpoints
    .sendTo(
      'katchup-delete-message',
      { body: { messageIds, groupFlag: false } },
      { label: `rules:cleanup:${as.key}`, auth: { principal: as }, allowLiveWrite: true },
    )
    .catch(() => undefined);
}

test.describe(
  'KPost Katchup · rules, by what each person sees',
  { tag: ['@api', '@katchup', '@regression'] },
  () => {
    test.skip(
      process.env.KATCHUP_LIFECYCLE !== 'true',
      'sends real messages between the QA accounts; set KATCHUP_LIFECYCLE=true',
    );

    test(
      '"Disappear After Reading": gone for both people once the recipient has read it',
      { annotation: [{ type: 'requirement', description: 'BR-KU-DISAPPEAR-READ' }] },
      async ({ endpoints }) => {
        const subject = `QA vanish-read ${Date.now()}`;
        let id: number | undefined;
        try {
          id = await send(endpoints, A, {
            receiver: B.username,
            subject,
            actualMessage: subject,
            messageType: SECRET,
            sharedType: SECRET,
            isVanished: true,
            secretMessageExpireTime: null,
          });
          expect(
            has(await thread(endpoints, A, B.username), id),
            'visible to A before B reads it',
          ).toBe(true);
          // B's first open returns it (and marks it read)…
          expect(has(await thread(endpoints, B, A.username), id), 'B can read it once').toBe(true);
          // …after which it has disappeared for both.
          expect(has(await thread(endpoints, B, A.username), id), 'gone for B after reading').toBe(
            false,
          );
          expect(has(await thread(endpoints, A, B.username), id), 'and gone for A').toBe(false);
        } finally {
          await remove(endpoints, A, [id]);
        }
      },
    );

    test(
      '"Disappear As Per Schedule": gone for both at the time set, even unread',
      { annotation: [{ type: 'requirement', description: 'BR-KU-DISAPPEAR-SCHED' }] },
      async ({ endpoints }) => {
        test.setTimeout(120_000);
        const subject = `QA vanish-timer ${Date.now()}`;
        const expireAt = Date.now() + 20_000;
        let id: number | undefined;
        try {
          id = await send(endpoints, A, {
            receiver: B.username,
            subject,
            actualMessage: subject,
            messageType: SECRET,
            sharedType: SECRET,
            isVanished: false,
            secretMessageExpireTime: expireAt,
          });
          expect(has(await thread(endpoints, A, B.username), id), 'visible before the time').toBe(
            true,
          );
          // Nobody reads it. Once the time has passed it must be gone for both.
          const msg = id;
          await expect
            .poll(async () => has(await thread(endpoints, A, B.username), msg), {
              message: 'gone for A once the time has passed',
              timeout: 60_000,
              intervals: [5_000],
            })
            .toBe(false);
          expect(Date.now(), 'and not before the time set').toBeGreaterThanOrEqual(
            expireAt - 2_000,
          );
          expect(
            has(await thread(endpoints, B, A.username), msg),
            'gone for B too, though unread',
          ).toBe(false);
        } finally {
          await remove(endpoints, A, [id]);
        }
      },
    );

    test(
      'the disappear setting cannot be changed after sending (an edit does not undo it)',
      { annotation: [{ type: 'requirement', description: 'BR-KU-DISAPPEAR-IMMUTABLE' }] },
      async ({ endpoints }) => {
        const subject = `QA vanish-lock ${Date.now()}`;
        let id: number | undefined;
        let edit: number | undefined;
        try {
          id = await send(endpoints, A, {
            receiver: B.username,
            subject,
            actualMessage: subject,
            messageType: SECRET,
            sharedType: SECRET,
            isVanished: true,
            secretMessageExpireTime: null,
          });
          // An edit that tries to turn the flag off (the web client never offers this: the bell menu,
          // and so Edit, is not shown on a secret message).
          edit = await send(endpoints, A, {
            receiver: B.username,
            subject,
            actualMessage: `${subject} edited`,
            messageType: code('editMessage'),
            sharedType: code('editMessage'),
            isVanished: false,
            secretMessageExpireTime: null,
            referenceMessageIDList: [id],
          });
          await thread(endpoints, B, A.username); // B reads it
          expect(
            has(await thread(endpoints, B, A.username), id),
            'the original still disappears after being read — the edit did not change its setting',
          ).toBe(false);
        } finally {
          await remove(endpoints, A, [id, edit]);
        }
      },
    );

    test(
      'a hidden-source forward never shows the recipient who originally wrote the message',
      { annotation: [{ type: 'requirement', description: 'BR-KU-FORWARD-HIDE' }] },
      async ({ endpoints }) => {
        const subject = `QA hidden-source ${Date.now()}`;
        let source: number | undefined;
        let forwarded: Row | undefined;
        try {
          source = await send(endpoints, A, {
            receiver: B.username,
            subject,
            actualMessage: subject,
          });
          // B forwards A's message to C with "Hide Source" (ForwardFooter.js sendMultiForward).
          const fwd = await endpoints.sendTo(
            'katchup-forward-multiple',
            {
              body: {
                forwardReceiverList: [C.username],
                groupForwardList: [],
                forwardMessageIDList: [source],
                messageType: HIDDEN_FORWARD,
                actualMessage: '',
                sessionID: 'Web-Reactjs',
              },
            },
            { label: 'rules:forward-hidden', auth: { principal: B }, allowLiveWrite: true },
          );
          expect(fwd.status, 'B forwards with Hide Source').toBeLessThan(300);
          // The hidden forward is processed in the background — wait for it to reach C.
          await expect
            .poll(
              async () => {
                forwarded = (await thread(endpoints, C, B.username)).rows.find(
                  (r) => r.messageType === HIDDEN_FORWARD && JSON.stringify(r).includes(subject),
                );
                return Boolean(forwarded);
              },
              {
                message:
                  'the forwarded message reaches C (#13208: a Hide Source forward is never delivered)',
                timeout: 30_000,
                intervals: [3_000],
              },
            )
            .toBe(true);
          expect(forwarded?.sender?.toLowerCase(), 'C sees it as from B, the forwarder').toBe(
            B.username.toLowerCase(),
          );
          const everything = JSON.stringify(forwarded).toLowerCase();
          expect(everything, "nowhere in C's copy is A's KPOST ID").not.toContain(
            A.username.toLowerCase(),
          );
          expect(everything, "nor A's name").not.toContain('qatest1 bench');
        } finally {
          await remove(endpoints, C, [forwarded?.msgID]);
          await remove(endpoints, A, [source]);
        }
      },
    );

    test(
      'a Reminder reaches the recipient as a Reminder that points at the original message',
      { annotation: [{ type: 'requirement', description: 'FR-KU-033' }] },
      async ({ endpoints }) => {
        const subject = `QA reminder ${Date.now()}`;
        let original: number | undefined;
        let reminder: number | undefined;
        try {
          original = await send(endpoints, A, {
            receiver: B.username,
            subject,
            actualMessage: subject,
          });
          // Bell → Reminder opens the composer as "Reminder Message"; sending posts messageType 3 with the
          // original as its reference (KatchupMessage.js handleSendKatchupMsg).
          reminder = await send(endpoints, A, {
            receiver: B.username,
            subject,
            actualMessage: `${subject} — please reply`,
            messageType: REMINDER,
            sharedType: REMINDER,
            referenceMessageIDList: [original],
          });
          const row = (await thread(endpoints, B, A.username)).rows.find(
            (r) => r.msgID === reminder,
          );
          expect(row, 'B receives the reminder').toBeTruthy();
          expect(row?.messageType, 'as a Reminder').toBe(REMINDER);
          const target =
            row?.referenceMessageIDList?.[0] ??
            (JSON.parse(row?.referenceMessage ?? '{}') as { msgID?: number }).msgID;
          expect(target, 'pointing at the original message').toBe(original);
        } finally {
          await remove(endpoints, A, [original, reminder]);
        }
      },
    );

    test(
      'Save keeps the chosen message and clears the rest — for the saver only',
      { annotation: [{ type: 'requirement', description: 'FR-KU-040' }] },
      async ({ endpoints }) => {
        const stamp = Date.now();
        let keep: number | undefined;
        let other: number | undefined;
        try {
          keep = await send(endpoints, C, {
            receiver: D.username,
            subject: `QA save keep ${stamp}`,
          });
          other = await send(endpoints, C, {
            receiver: D.username,
            subject: `QA save other ${stamp}`,
          });
          const saved = await endpoints.sendTo(
            'katchup-save-messages',
            { body: { msgIDs: [keep], groupFlag: false, receiver: D.username } },
            { label: 'rules:save', auth: { principal: C }, allowLiveWrite: true },
          );
          expect(saved.status, 'C saves one message').toBe(200);

          const mine = await thread(endpoints, C, D.username);
          expect(has(mine, keep), 'the saved message stays in C’s conversation').toBe(true);
          expect(has(mine, other), 'the other message is cleared from C’s view').toBe(false);
          expect(mine.deleted, 'and listed as cleared').toContain(other);

          const theirs = await thread(endpoints, D, C.username);
          expect(
            has(theirs, keep) && has(theirs, other),
            'D still sees both — Save is C’s alone',
          ).toBe(true);
        } finally {
          await remove(endpoints, C, [keep, other]);
          await remove(endpoints, D, [keep, other]);
        }
      },
    );
  },
);
