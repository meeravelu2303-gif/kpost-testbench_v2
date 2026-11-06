import { KATCHUP_MESSAGE_TYPE, KATCHUP_STATUS } from '@api/contract/kpost-types';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import type { RequestSpec } from '@api/client/request-builder';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { deleteUploaded, type Uploaded } from '../../../support/attachments';
import {
  conversationText,
  deleteMessages,
  msgIDsOf,
  rowsOf,
  sameBytes,
  sendAttachment,
  sendText,
} from '../../../support/katchup-messages';
import { retryOrSkip } from '../../../support/live-condition';

/**
 * A foreign attachment uuid on the send and forward routes. A sends B a file; C, who has no part in
 * it, names its uuid on a route that copies uuids onto a new message. The backend copies them with an
 * unscoped `uuid IN (...)` lookup (KatchupAttachmentRepository.java:28-29; KatchupControllerV2.java
 * 313-333, 1724-1727, 1855-1860, 2289-2290), and download access is "the sender of any message that
 * carries the uuid" (KatchupServiceImpl.java:1459-1464), so the read-back that decides is C's own
 * download afterwards. Owner control: B (the recipient) downloads the exact bytes. If C can already
 * download it before the attack, nothing is judged (katchup-attachment-idor owns that finding).
 * forwardKatchupMultipleMsgs also checks the source messages (KatchupServiceImpl.java:2546-2549):
 * naming A's message must be refused, judged by what R receives.
 */
const P = AUTH_PROFILES.kpost.principals;
const A = P.find((p) => p.key === 'personal'); // owns the attachment
const B = P.find((p) => p.key === 'victim'); // its recipient
const C = P.find((p) => p.key === 'personal-3'); // the outsider
const R = P.find((p) => p.key === 'personal-4'); // whom C sends to
const stamp = Date.now();

const download = (endpoints: EndpointExecutor, who: Principal, up: Uploaded, label: string) =>
  endpoints.sendTo(
    'katchup-download',
    { pathParams: { uuid: up.uuid } },
    {
      label,
      auth: { principal: who },
      allowLiveRead: true,
      ownedIdentifiers: [up.uuid],
      timeoutMs: 60_000,
    },
  );

/** The routes that take a uuid list, each with the web client's own body shape. */
const ROUTES: ReadonlyArray<{
  id: string;
  name: string;
  /** The request naming the uuid, sent by `from` (ownMsgID: a message C itself sent R). */
  spec: (uuid: string, ownMsgID: number, from: Principal) => RequestSpec;
  needsOwnMessage?: boolean;
}> = [
  {
    id: 'katchup-send-bulk',
    name: 'sendBulkKatchupMsg',
    spec: (uuid) => ({
      body: {
        receiverList: [R!.username],
        messageType: KATCHUP_MESSAGE_TYPE.bulkMessage,
        subject: 'QA xuser bulk',
        actualMessage: 'QA bench bulk with a foreign attachment.',
        messageTime: Date.now(),
        serverTime: Date.now(),
        status: KATCHUP_STATUS.sent,
        sessionID: 'Web-Reactjs',
        temporaryMsgID: 1,
        attachmentCaption: null,
        uuid: [uuid],
      },
    }),
  },
  {
    id: 'katchup-send-forward-selected-attachment',
    name: 'sendMessageForForwardSelectedAttachment',
    // The web client's full body (ForwardFooter.js:434-466): the send shape with type 24.
    spec: (uuid, _own, from) => ({
      body: sendShape({
        receiver: R!.username,
        sender: from.username,
        messageType: KATCHUP_MESSAGE_TYPE.forwardSelectedAttachment,
        subject: 'QA xuser forward selected',
        actualMessage: 'QA bench forward of a foreign attachment.',
        attachmentCaption: '[]',
        referenceMessage: null,
        sharedMessageDetails: null,
        sharedType: 0,
        uuid: [uuid],
      }),
    }),
  },
  {
    id: 'katchup-forward-message-new',
    name: 'forwardKatchupMessageNew',
    // ForwardFooter.js:662-683 (referenceMessage is a JSON string the client builds).
    spec: (uuid) => ({
      body: {
        receiver: '',
        messageType: KATCHUP_MESSAGE_TYPE.forwardMessageReveal,
        subject: 'QA xuser forward new',
        actualMessage: 'QA bench forward of a foreign attachment.',
        attachmentCaption: '[]',
        referenceMessage: null,
        referenceMessageIDList: [],
        forwardReceiverList: [R!.username],
        groupForwardList: [],
        uuid: [uuid],
        sessionID: 'Web-Reactjs',
        temporaryMsgID: 8989,
        groupFlag: 'false',
      },
    }),
  },
  {
    id: 'katchup-forward-multiple',
    name: 'forwardKatchupMultipleMsgs',
    needsOwnMessage: true,
    // ForwardFooter.js:1426-1436; the source message is C's own, so only the uuid is foreign.
    spec: (uuid, ownMsgID) => ({
      body: {
        forwardReceiverList: [R!.username],
        groupForwardList: [],
        forwardMessageIDList: [ownMsgID],
        attachmentCaption: '[]',
        uuid: [uuid],
        messageType: KATCHUP_MESSAGE_TYPE.forwardMessageReveal,
        sessionID: 'Web-Reactjs',
        actualMessage: 'QA bench forward of a foreign attachment.',
      },
    }),
  },
];

test.describe(
  'KPost Security · Katchup send and forward routes do not hand out another pair’s attachment @api @kpost-api @security @katchup',
  {
    tag: ['@api', '@katchup', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    // Each file read takes ~12 s on the test server (#1364); a test makes three.
    test.describe.configure({ mode: 'default', timeout: 180_000 });
    test.skip(
      !A || !B || !C || !R,
      'needs the personal, victim, personal-3 and personal-4 principals',
    );
    test.skip(
      process.env.KATCHUP_LIFECYCLE !== 'true' || process.env.AWS_LIFECYCLE !== 'true',
      'sends real messages and uploads to S3; set KATCHUP_LIFECYCLE=true and AWS_LIFECYCLE=true',
    );

    for (const route of ROUTES) {
      test(`an outsider cannot unlock another pair's attachment by naming its uuid (${route.name}) @api @kpost-api @security`, async ({
        endpoints,
      }) => {
        const tag = `xuser-uuid-${route.id}`;
        let up: Uploaded | undefined;
        let msgIDs: number[] = [];
        const outsiderSent: number[] = [];
        try {
          ({ up, msgIDs } = await sendAttachment(endpoints, A!, B!, tag));
          const own = await download(endpoints, B!, up, `${tag}:recipient-control`);
          expect(own.status, 'control: the recipient downloads the attachment').toBe(200);
          expect(sameBytes(own, up), 'control: with the exact uploaded bytes').toBe(true);

          const before = await download(endpoints, C!, up, `${tag}:outsider-before`);
          retryOrSkip(before.status === 0, 'download did not answer the outsider (timeout)');
          if (sameBytes(before, up)) {
            test.info().annotations.push({
              type: 'not-judged',
              description: 'the outsider could already download the uuid before naming it',
            });
            return;
          }

          let ownMsgID = 0;
          if (route.needsOwnMessage) {
            const mine = await sendText(
              endpoints,
              C!,
              R!,
              'QA xuser own source',
              `QA bench own message ${stamp}`,
              `${tag}:own-source`,
            );
            outsiderSent.push(...mine);
            ownMsgID = mine[0] ?? 0;
            test.skip(!ownMsgID, 'C’s own source message got no msgID back; nothing to forward');
          }
          const spec = route.spec(up.uuid, ownMsgID, C!);
          const attack = await endpoints.sendTo(route.id, spec, {
            label: `${tag}:outsider-attack`,
            auth: { principal: C! },
            allowLiveWrite: true,
            ownedIdentifiers: [up.uuid],
          });
          outsiderSent.push(...msgIDsOf(rowsOf(attack)));
          if (attack.status >= 500 && !route.needsOwnMessage) {
            // Owner control for the crash: B, who may see the file, sends the identical request. Only
            // when B's works is C's 5xx the route failing the outsider (else the shape or route is broken).
            const control = await endpoints.sendTo(route.id, route.spec(up.uuid, 0, B!), {
              label: `${tag}:recipient-crash-control`,
              auth: { principal: B! },
              allowLiveWrite: true,
              ownedIdentifiers: [up.uuid],
            });
            await deleteMessages(
              endpoints,
              B!,
              msgIDsOf(rowsOf(control)),
              `${tag}:cleanup-control`,
            );
            if (control.status >= 500)
              test.info().annotations.push({
                type: 'not-judged',
                description: `${route.name}: HTTP ${attack.status} for C, but also HTTP ${control.status} for the recipient's identical call, so the crash is not the outsider's`,
              });
            else
              expect
                .soft(
                  attack.status,
                  `${route.name} refuses the outsider without a server error (the recipient's call: HTTP ${control.status})`,
                )
                .toBeLessThan(500);
          } else
            expect
              .soft(attack.status, `${route.name} answers without a server error`)
              .toBeLessThan(500);

          const after = await download(endpoints, C!, up, `${tag}:outsider-after`);
          retryOrSkip(after.status === 0, 'download did not answer the outsider (timeout)');
          const leaked = sameBytes(after, up);
          if (leaked)
            endpoints.recordBusinessRuleViolation({
              endpointId: route.id,
              ruleId: `IDOR-${route.id}-foreign-uuid`,
              rule: `${route.name} must only attach files the caller may already see; naming another pair's attachment uuid must not let the caller (or the recipient) download it.`,
              expected: `the request is refused, or ${C!.username} still cannot download the uuid afterwards`,
              actual:
                `${route.name} answered HTTP ${attack.status}; ${C!.username} was refused the file before (HTTP ${before.status}) ` +
                `and downloaded its exact bytes after (HTTP ${after.status}): ${A!.username}'s attachment to ${B!.username}, uuid ${up.uuid}`,
              request: spec,
              correlationId: attack.correlationId,
            });
          expect
            .soft(
              leaked,
              `IDOR: naming a foreign uuid on ${route.name} must not unlock another pair's attachment (HTTP ${attack.status})`,
            )
            .toBe(false);
        } finally {
          // Whatever C's request created, in C's conversation with R.
          const leftovers = await conversationText(endpoints, C!, R!, `${tag}:cleanup-read`).catch(
            () => undefined,
          );
          const ours = new Set(outsiderSent);
          for (const id of leftovers?.msgIDs ?? [])
            if (id > Math.min(...msgIDs, Infinity)) ours.add(id);
          await deleteMessages(endpoints, C!, [...ours], `${tag}:cleanup-outsider`);
          await deleteMessages(endpoints, A!, msgIDs, `${tag}:cleanup`);
          await deleteUploaded(endpoints, A!, up?.uuid, `${tag}:cleanup-file`);
        }
      });
    }

    test("an outsider cannot forward another pair's message by its msgID (forwardKatchupMultipleMsgs) @api @kpost-api @security", async ({
      endpoints,
    }) => {
      const tag = 'xuser-fwd-multi-msg';
      const secret = `QA xuser private ${stamp}`;
      let msgIDs: number[] = [];
      let forwarded: number[] = [];
      try {
        msgIDs = await sendText(endpoints, A!, B!, 'QA xuser private', secret, tag);
        const msgID = msgIDs[0];
        test.skip(!msgID, 'the setup message got no msgID back; nothing to name');
        // Owner control: B (who received it) may forward it to R.
        const asBody = (from: Principal) => ({
          body: {
            forwardReceiverList: [R!.username],
            groupForwardList: [],
            forwardMessageIDList: [msgID],
            attachmentCaption: '[]',
            uuid: [],
            messageType: KATCHUP_MESSAGE_TYPE.forwardMessageReveal,
            sessionID: 'Web-Reactjs',
            actualMessage: `QA bench forward by ${from.key}`,
          },
        });
        const control = await endpoints.sendTo('katchup-forward-multiple', asBody(B!), {
          label: `${tag}:recipient-control`,
          auth: { principal: B! },
          allowLiveWrite: true,
          ownedIdentifiers: [msgID!],
        });
        const controlIds = msgIDsOf(rowsOf(control));
        await deleteMessages(endpoints, B!, controlIds, `${tag}:cleanup-control`);
        test.skip(
          control.status >= 300,
          `owner control: the recipient's own forward was refused (HTTP ${control.status}), so C's refusal proves nothing`,
        );

        const spec = asBody(C!);
        const attack = await endpoints.sendTo('katchup-forward-multiple', spec, {
          label: `${tag}:outsider`,
          auth: { principal: C! },
          allowLiveWrite: true,
          ownedIdentifiers: [msgID!],
        });
        forwarded = msgIDsOf(rowsOf(attack));
        const atR = await conversationText(endpoints, R!, C!, `${tag}:receiver-read`);
        const leaked = atR.text.includes(secret) || attack.bodyText?.includes(secret) === true;
        if (leaked)
          endpoints.recordBusinessRuleViolation({
            endpointId: 'katchup-forward-multiple',
            ruleId: 'IDOR-katchup-forward-multiple-foreign-message',
            rule: 'forwardKatchupMultipleMsgs must forward only messages the caller sent or received.',
            expected: `HTTP 404 "One or more messages not found" and nothing of ${A!.username}'s message reaches ${R!.username}`,
            actual: `HTTP ${attack.status}: ${C!.username} forwarded ${A!.username}'s message ${msgID} to ${B!.username} on to ${R!.username}`,
            request: spec,
            correlationId: attack.correlationId,
          });
        expect
          .soft(
            leaked,
            `IDOR: an outsider must not forward another pair's message (HTTP ${attack.status})`,
          )
          .toBe(false);
      } finally {
        await deleteMessages(endpoints, C!, forwarded, `${tag}:cleanup-outsider`);
        await deleteMessages(endpoints, A!, msgIDs, `${tag}:cleanup`);
      }
    });
  },
);
