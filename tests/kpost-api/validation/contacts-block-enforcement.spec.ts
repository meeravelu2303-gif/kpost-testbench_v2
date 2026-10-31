import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { KALL_STATUS } from '@api/contract/kpost-types';
import { initiateShape } from '@api/definitions/kpost/kall/direct.api';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * What blocking a contact must stop, enforced by the server, not just the screen (the web only
 * checks its own copy of the contact list; kall-validation shows it calling a blocked contact):
 * after A blocks B, A's call to B and A's message to B are refused, and B's message to A is not
 * delivered. A is qatest5, B qatest4; the address book is put back as it was.
 */
const K = AUTH_PROFILES.kpost;
const A = K.principals.find((p) => p.key === 'personal-5');
const B = K.principals.find((p) => p.key === 'personal-4');

interface Row {
  contactID?: string;
  firstName?: string;
  lastName?: string;
  referenceName?: string;
  userType?: string;
  isBlocked?: boolean;
  deleteStatus?: boolean;
}

const send = (
  endpoints: EndpointExecutor,
  id: string,
  as: Principal,
  body: object,
  label: string,
) =>
  endpoints.sendTo(
    id,
    { body },
    { label: `block-enforcement:${label}`, auth: { principal: as }, allowLiveWrite: true },
  );

async function rowOfB(endpoints: EndpointExecutor): Promise<Row | undefined> {
  const ex = await endpoints.sendTo(
    'contacts-my-contacts',
    { body: { lastfetchDate: null } },
    { label: 'block-enforcement:read', auth: { principal: A! } },
  );
  const parsed = ex.json();
  const rows = ((parsed.ok ? parsed.value : {}) as { contacts_added?: Row[] }).contacts_added;
  return (rows ?? []).find(
    (r) => r.contactID?.toLowerCase() === B!.username.toLowerCase() && r.deleteStatus !== true,
  );
}

const firstMsgId = (bodyText: string | undefined): number | undefined => {
  const data = (JSON.parse(bodyText || '{}') as { data?: Array<{ msgID?: number }> }).data;
  return Array.isArray(data) ? data[0]?.msgID : undefined;
};

test.describe(
  'KPost Contacts · a block is enforced by the server',
  { tag: ['@api', '@contacts', '@security', '@regression'] },
  () => {
    test.skip(
      process.env.CONTACTS_LIFECYCLE !== 'true' || process.env.KALL_LIFECYCLE !== 'true',
      'blocks a QA contact and tries a call and messages; set CONTACTS_LIFECYCLE and KALL_LIFECYCLE',
    );
    test.skip(!A || !B, 'needs the 4th and 5th QA accounts');

    test('after A blocks B: no call from A, no message from A, B’s message not delivered', async ({
      endpoints,
    }) => {
      const original = await rowOfB(endpoints);
      const sentIds: Array<[Principal, number]> = [];
      let kallID: number | undefined;
      try {
        if (!original) {
          await send(
            endpoints,
            'contacts-add',
            A!,
            {
              contactID: B!.username,
              firstName: 'qatest4',
              lastName: 'bench',
              referenceName: '',
              userType: 'PERSONAL',
            },
            'add',
          );
        }
        const blocked = await send(
          endpoints,
          'contacts-block',
          A!,
          { contactID: B!.username, isBlocked: true },
          'block',
        );
        expect(blocked.status, 'A blocks B (setup)').toBeLessThan(300);

        // 1. A calls B.
        const call = await send(
          endpoints,
          'kall-initiate',
          A!,
          initiateShape({ receiver: B!.username }),
          'call',
        );
        const callBody = JSON.parse(call.bodyText || '{}') as { data?: { kallID?: number } };
        kallID = callBody.data?.kallID;
        if (call.status < 300) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'kall-initiate',
            ruleId: 'BLOCK-kall-to-blocked-contact',
            rule: 'initiateKall must refuse a call to a contact the caller has blocked (the web refuses on screen only, and only when its own contact list knows about the block).',
            expected: 'a 4xx: the receiver is blocked',
            actual: `initiateKall answered ${call.status} for a blocked contact`,
            request: { body: initiateShape({ receiver: B!.username }) },
          });
        }
        expect
          .soft(call.status, 'A cannot call a contact A has blocked')
          .toBeGreaterThanOrEqual(400);

        // 2. A messages B.
        const marker = `QA block enforcement ${Date.now()}`;
        const fromA = await send(
          endpoints,
          'katchup-send-message',
          A!,
          sendShape({ receiver: B!.username, subject: marker, actualMessage: marker }),
          'message-from-blocker',
        );
        const aId = firstMsgId(fromA.bodyText);
        if (aId) sentIds.push([A!, aId]);
        if (fromA.status < 300) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'katchup-send-message',
            ruleId: 'BLOCK-message-to-blocked-contact',
            rule: 'sendMessage must refuse a message from A to a contact A has blocked (the web says "is blocked Unblock to send message").',
            expected: 'a 4xx: the receiver is blocked',
            actual: `sendMessage answered ${fromA.status} and created msg ${aId ?? '?'}`,
            request: { body: { receiver: B!.username } },
          });
        }
        expect
          .soft(fromA.status, 'A cannot message a contact A has blocked')
          .toBeGreaterThanOrEqual(400);

        // 3. B messages A: it may be accepted, but must not reach A.
        const fromB = await send(
          endpoints,
          'katchup-send-message',
          B!,
          sendShape({
            receiver: A!.username,
            subject: `${marker} B`,
            actualMessage: `${marker} B`,
          }),
          'message-from-blocked',
        );
        const bId = firstMsgId(fromB.bodyText);
        if (bId) sentIds.push([B!, bId]);
        const inbox = await endpoints.sendTo(
          'katchup-conversation',
          { body: { groupFlag: false, firstMsgID: null, lastMsgID: null, receiver: B!.username } },
          { label: 'block-enforcement:a-reads', auth: { principal: A! } },
        );
        const delivered = (inbox.bodyText ?? '').includes(`${marker} B`);
        if (delivered) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'katchup-send-message',
            ruleId: 'BLOCK-message-from-blocked-contact-delivered',
            rule: 'A message from a contact the receiver has blocked must not be delivered to the receiver.',
            expected: "B's message is not in A's conversation",
            actual: `B's message (send answered ${fromB.status}) appears in A's conversation with B`,
            request: { body: { receiver: A!.username } },
          });
        }
        expect.soft(delivered, 'a blocked contact’s message does not reach A').toBe(false);
      } finally {
        if (kallID) {
          await send(
            endpoints,
            'kall-update-status',
            A!,
            { kallID, kallStatus: KALL_STATUS.cancelled },
            'cancel-call',
          ).catch(() => undefined);
        }
        for (const [who, msgID] of sentIds) {
          await send(
            endpoints,
            'katchup-delete-message',
            who,
            { messageIds: [msgID], groupFlag: false },
            'cleanup',
          ).catch(() => undefined);
        }
        // The address book as it was: B unblocked unless already blocked; removed unless present.
        if (!original?.isBlocked) {
          await send(
            endpoints,
            'contacts-block',
            A!,
            { contactID: B!.username, isBlocked: false },
            'unblock',
          ).catch(() => undefined);
        }
        if (!original) {
          await send(endpoints, 'contacts-delete', A!, { contactID: B!.username }, 'remove').catch(
            () => undefined,
          );
        }
      }
    });
  },
);
