import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { expect, test } from '@fixtures';
import { conversationText, deleteMessages, sendText } from '../../../support/katchup-messages';
import { retryOrSkip } from '../../../support/live-condition';

/**
 * Katchup routes that take a contact, group or message id but are meant to answer only about the
 * caller's own conversations (the JWT is the caller; KatchupControllerV2 / KatchupRepository). Each
 * test has A send B a real message with a unique marker, proves A's own identical call sees it
 * (owner control), and checks that C, who has no part in it, gets none of it and changes none of it.
 * Messages are removed in `finally`.
 */
const P = AUTH_PROFILES.kpost.principals;
const A = P.find((p) => p.key === 'personal'); // sender
const B = P.find((p) => p.key === 'victim'); // recipient
const C = P.find((p) => p.key === 'personal-3'); // outsider
const stamp = Date.now();

test.describe(
  'KPost Security · Katchup conversation reads and saves stay inside the caller’s own conversations @api @kpost-api @security @katchup',
  {
    tag: ['@api', '@katchup', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.describe.configure({ mode: 'default', timeout: 120_000 });
    test.skip(!A || !B || !C, 'needs the personal, victim and personal-3 principals');
    test.skip(
      process.env.KATCHUP_LIFECYCLE !== 'true',
      'sends real messages; set KATCHUP_LIFECYCLE=true',
    );

    test("an outsider never gets another pair's subjects (getKatchupMessagesSubject) @api @kpost-api @security", async ({
      endpoints,
    }) => {
      // KatchupRepository.java:33-37: subjects where (sender = me AND receiver = id) or the reverse.
      const subject = `QA xuser subject ${stamp}`;
      let msgIDs: number[] = [];
      try {
        msgIDs = await sendText(
          endpoints,
          A!,
          B!,
          subject,
          'QA bench subject probe.',
          'xuser-subject',
        );
        const subjects = (who: Principal, id: string, label: string) =>
          endpoints.sendTo(
            'katchup-messages-subject',
            { pathParams: { id } },
            { label: `xuser-subject:${label}`, auth: { principal: who }, allowLiveRead: true },
          );
        const control = await subjects(A!, B!.username, 'owner');
        test.skip(
          control.status >= 300 || !control.bodyText?.includes(subject),
          `owner control: A's own subject list with B does not show the new subject (HTTP ${control.status})`,
        );
        for (const [variant, id] of [
          ['naming the recipient', B!.username],
          ['naming the sender', A!.username],
        ] as const) {
          const attack = await subjects(C!, id, `outsider:${variant.replace(/\W+/g, '-')}`);
          retryOrSkip(attack.status === 0, 'getKatchupMessagesSubject did not answer (timeout)');
          const leaked = attack.bodyText?.includes(subject) === true;
          if (leaked)
            endpoints.recordBusinessRuleViolation({
              endpointId: 'katchup-messages-subject',
              ruleId: 'IDOR-katchup-messages-subject-foreign-pair',
              rule: "getKatchupMessagesSubject lists only the subjects of the caller's own conversation with the id.",
              expected: `no subject of ${A!.username} ↔ ${B!.username} for ${C!.username}`,
              actual: `HTTP ${attack.status} (${variant}): ${C!.username} got the subject "${subject}"`,
              request: { pathParams: { id } },
              correlationId: attack.correlationId,
            });
          expect
            .soft(leaked, `an outsider must not see another pair's subject (${variant})`)
            .toBe(false);
        }
      } finally {
        await deleteMessages(endpoints, A!, msgIDs, 'xuser-subject:cleanup');
      }
    });

    test('an outsider cannot learn which of another pair’s messages were deleted (getDeletedKatchupMsgIds) @api @kpost-api @security', async ({
      endpoints,
    }) => {
      // KatchupRepository.java:81-83: msg_id = :id AND the caller deleted it (as sender or receiver).
      const msgIDs = await sendText(
        endpoints,
        A!,
        B!,
        'QA xuser deleted',
        `QA bench deleted probe ${stamp}`,
        'xuser-deleted',
      );
      const msgID = msgIDs[0];
      test.skip(!msgID, 'the setup message got no msgID back; nothing to delete');
      await deleteMessages(endpoints, A!, msgIDs, 'xuser-deleted:sender-deletes');
      const deleted = (who: Principal, label: string) =>
        endpoints.sendTo(
          'katchup-deleted-message-ids',
          { pathParams: { lastMsgID: String(msgID) } },
          {
            label: `xuser-deleted:${label}`,
            auth: { principal: who },
            allowLiveRead: true,
            ownedIdentifiers: [msgID!],
          },
        );
      const lists = (text: string | undefined): boolean =>
        new RegExp(`(^|[^0-9])${msgID}([^0-9]|$)`).test(
          JSON.stringify((JSON.parse(text || '{}') as { data?: unknown }).data ?? null),
        );
      const control = await deleted(A!, 'owner');
      test.skip(
        control.status >= 300 || !lists(control.bodyText),
        `owner control: the sender's own deleted-id list does not show message ${msgID} (HTTP ${control.status})`,
      );
      const attack = await deleted(C!, 'outsider');
      retryOrSkip(attack.status === 0, 'getDeletedKatchupMsgIds did not answer (timeout)');
      const leaked = attack.status < 300 && lists(attack.bodyText);
      if (leaked)
        endpoints.recordBusinessRuleViolation({
          endpointId: 'katchup-deleted-message-ids',
          ruleId: 'IDOR-katchup-deleted-ids-foreign-message',
          rule: 'getDeletedKatchupMsgIds reports only messages the caller deleted.',
          expected: `no id for ${C!.username}`,
          actual: `HTTP ${attack.status}: ${C!.username} was told ${A!.username}'s message ${msgID} to ${B!.username} was deleted`,
          request: { pathParams: { lastMsgID: String(msgID) } },
          correlationId: attack.correlationId,
        });
      expect.soft(leaked, 'an outsider must not see another pair’s deleted message id').toBe(false);
    });

    test("an outsider's saveKatchupMessages cannot touch another pair's conversation @api @kpost-api @security", async ({
      endpoints,
    }) => {
      // saveKatchupMessages keeps the listed messages and hides every OTHER message of the caller's
      // conversation with `receiver` (KatchupDaoImpl.java:485-505; the web app's "only the selected
      // message will be saved, the rest will be deleted"). C names A's message to B, with A as the
      // receiver: only C's own view of C ↔ A can change (hidden for C, like C deleting its own
      // messages), and A ↔ B must not.
      const secret = `QA xuser save ${stamp}`;
      let msgIDs: number[] = [];
      try {
        msgIDs = await sendText(endpoints, A!, B!, 'QA xuser save', secret, 'xuser-save');
        const msgID = msgIDs[0];
        test.skip(!msgID, 'the setup message got no msgID back; nothing to name');
        const before = await conversationText(endpoints, B!, A!, 'xuser-save:recipient-before');
        test.skip(
          before.status >= 300 || !before.text.includes(secret),
          `owner control: B's own conversation with A does not show the new message (HTTP ${before.status})`,
        );
        const spec = { body: { msgIDs: [msgID], groupFlag: false, receiver: A!.username } };
        const attack = await endpoints.sendTo('katchup-save-messages', spec, {
          label: 'xuser-save:outsider',
          auth: { principal: C! },
          allowLiveWrite: true,
          ownedIdentifiers: [msgID!],
        });
        retryOrSkip(attack.status === 0, 'saveKatchupMessages did not answer (timeout)');
        expect
          .soft(attack.status, 'saveKatchupMessages answers without a server error')
          .toBeLessThan(500);
        const disclosed = attack.bodyText?.includes(secret) === true;
        const forB = await conversationText(endpoints, B!, A!, 'xuser-save:recipient-after');
        const forA = await conversationText(endpoints, A!, B!, 'xuser-save:sender-after');
        retryOrSkip(forB.status >= 300 || forA.status >= 300, 'a read-back of A ↔ B failed');
        const hidden = !forB.text.includes(secret) || !forA.text.includes(secret);
        if (hidden || disclosed)
          endpoints.recordBusinessRuleViolation({
            endpointId: 'katchup-save-messages',
            ruleId: 'IDOR-katchup-save-messages-foreign-conversation',
            rule: "saveKatchupMessages acts only on the caller's own conversation; naming another pair's message must neither hide it from them nor return its content.",
            expected: `${A!.username} ↔ ${B!.username} still shows the message for both, and ${C!.username} gets none of it`,
            actual: hidden
              ? `after ${C!.username}'s call (HTTP ${attack.status}) message ${msgID} is gone from ${forB.text.includes(secret) ? A!.username : B!.username}'s conversation`
              : `HTTP ${attack.status}: the answer to ${C!.username} carried the message text`,
            request: spec,
            correlationId: attack.correlationId,
          });
        expect.soft(hidden, "an outsider's save must not hide another pair's message").toBe(false);
        expect
          .soft(disclosed, "an outsider's save must not return another pair's message")
          .toBe(false);
      } finally {
        await deleteMessages(endpoints, A!, msgIDs, 'xuser-save:cleanup');
      }
    });

    test('forwardMessageBacktrackByMsgID answers no ordinary account, not even the message’s own sender @api @kpost-api @security', async ({
      endpoints,
    }) => {
      // Only the system sender may call it (KatchupControllerV2.java:2366, 2397-2402: 403 for anyone
      // else). Both the sender of the message and an outsider are ordinary accounts.
      const secret = `QA xuser backtrack ${stamp}`;
      let msgIDs: number[] = [];
      try {
        msgIDs = await sendText(endpoints, A!, B!, 'QA xuser backtrack', secret, 'xuser-backtrack');
        const msgID = msgIDs[0];
        test.skip(!msgID, 'the setup message got no msgID back; nothing to name');
        for (const [who, principal] of [
          ['the sender', A!],
          ['an outsider', C!],
        ] as const) {
          const spec = { body: { msgID } };
          const ex = await endpoints.sendTo('katchup-forward-backtrack', spec, {
            label: `xuser-backtrack:${principal.key}`,
            auth: { principal },
            allowLiveRead: true,
            ownedIdentifiers: [msgID!],
          });
          retryOrSkip(ex.status === 0, 'forwardMessageBacktrackByMsgID did not answer (timeout)');
          const answered = ex.status < 300 || ex.bodyText?.includes(secret) === true;
          if (answered)
            endpoints.recordBusinessRuleViolation({
              endpointId: 'katchup-forward-backtrack',
              ruleId: 'AUTHZ-katchup-forward-backtrack-ordinary-account',
              rule: 'forwardMessageBacktrackByMsgID is for the system sender only; every ordinary account gets 403.',
              expected:
                'HTTP 403 "You are not authorized to access this resource" and no message data',
              actual: `HTTP ${ex.status} for ${who} (${principal.username}): ${ex.bodyText?.slice(0, 200) ?? ''}`,
              request: spec,
              correlationId: ex.correlationId,
            });
          expect.soft(ex.status, `${who} is refused the system-only route`).toBe(403);
          expect
            .soft(ex.bodyText?.includes(secret) === true, `${who} gets no message content`)
            .toBe(false);
        }
      } finally {
        await deleteMessages(endpoints, A!, msgIDs, 'xuser-backtrack:cleanup');
      }
    });
  },
);
