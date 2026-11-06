import { KATCHUP_MESSAGE_TYPE } from '@api/contract/kpost-types';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { AUTH_PROFILES } from '@config/auth-profile';
import { expect, test } from '@fixtures';
import { deleteUploaded, type Uploaded } from '../../../support/attachments';
import { expectStored } from '../../../support/db-stored';
import {
  conversationText,
  deleteMessages,
  msgIDsOf,
  rowsOf,
  sendAttachment,
} from '../../../support/katchup-messages';
import { retryOrSkip } from '../../../support/live-condition';

/**
 * /v2/common/sendMessage is the phone app's "forward selected attachments" route
 * (katchup_api.dart:1310-1328 postMessageForwardSelectedAttachment, called from
 * katchup_message_controller.dart:4497 and :4652). It is the FIRST of the client's two steps: it stores
 * the picked attachments as a hidden type-24 record, and the client then sends the real forward through
 * forwardKatchupMessageNew referencing it (web ForwardFooter.js:467-545). The rule, as the server now
 * enforces it (CommonControllerV2.java:874-890, KP-12B132): the record is FROM the logged-in user (a
 * sender named in the body is ignored), holds exactly the picked attachment, and stays out of the
 * recipient's chat (the 1:1 conversation excludes type 24 by design, KatchupDaoImpl, commit 8bc433cc).
 */
const P = AUTH_PROFILES.kpost.principals;
const A = P.find((p) => p.key === 'personal'); // sent the attachment, and forwards it
const B = P.find((p) => p.key === 'victim'); // received the original
const R = P.find((p) => p.key === 'personal-4'); // the forward's recipient
const C = P.find((p) => p.key === 'personal-3'); // named as sender in the body, never the sender
const stamp = Date.now();

test.describe(
  'KPost Common · the phone app’s forward-selected-attachments step stores the picked files, from the caller @api @kpost-api @katchup',
  { tag: ['@api', '@katchup', '@regression'] },
  () => {
    test.describe.configure({ timeout: 180_000 });
    test.skip(
      !A || !B || !R || !C,
      'needs the personal, victim, personal-3 and personal-4 principals',
    );
    test.skip(
      process.env.KATCHUP_LIFECYCLE !== 'true' || process.env.AWS_LIFECYCLE !== 'true',
      'sends real messages and uploads to S3; set KATCHUP_LIFECYCLE=true and AWS_LIFECYCLE=true',
    );

    test('common/sendMessage stores a hidden type-24 record from the caller with exactly the picked attachment', async ({
      endpoints,
      databases,
    }) => {
      const subject = `QA common forward ${stamp}`;
      let up: Uploaded | undefined;
      let original: number[] = [];
      let forwarded: number[] = [];
      try {
        ({ up, msgIDs: original } = await sendAttachment(endpoints, A!, B!, 'common-forward'));
        // The phone's body (KatchupSelectedAttachmentSendMessageRequestModel): the send shape, type
        // 24, the picked uuid. The body also names C as sender, which the server must ignore.
        const spec = {
          body: sendShape({
            receiver: R!.username,
            sender: C!.username,
            messageType: KATCHUP_MESSAGE_TYPE.forwardSelectedAttachment,
            subject,
            actualMessage: 'QA bench common forward.',
            attachmentCaption: '[]',
            uuid: [up.uuid],
          }),
        };
        const sent = await endpoints.sendTo('common-send-message', spec, {
          label: 'common-forward:send',
          auth: { principal: A! },
          allowLiveWrite: true,
          ownedIdentifiers: [up.uuid, C!.username],
        });
        retryOrSkip(sent.status === 0, 'common/sendMessage did not answer (timeout)');
        expect(sent.status, 'the forward is accepted').toBe(200);
        forwarded = msgIDsOf(rowsOf(sent));
        const msgID = forwarded[0];
        expect(msgID, 'the forward is a new message with its own id').toBeTruthy();

        // The answer is the record the client's next step forwards: type 24, the picked attachment.
        const row = rowsOf(sent)[0] ?? {};
        expect
          .soft(row.messageType, 'the record is a forward-selected-attachments record')
          .toBe(KATCHUP_MESSAGE_TYPE.forwardSelectedAttachment);
        expect
          .soft(
            JSON.stringify(row.attachmentUuid ?? row.attachmentPath ?? ''),
            'holding the picked attachment',
          )
          .toContain(up.uuid);
        // By design it is not a chat message yet: the recipient's chat does not show it.
        const atR = await conversationText(endpoints, R!, A!, 'common-forward:recipient');
        expect
          .soft(atR.msgIDs, 'the hidden step-one record stays out of the recipient’s chat')
          .not.toContain(msgID);
        // Nothing arrived as if from the person the body named.
        const asC = await conversationText(endpoints, R!, C!, 'common-forward:named-sender');
        expect
          .soft(
            asC.text.includes(subject),
            'nothing reaches the recipient in the named sender’s name',
          )
          .toBe(false);

        // CommonControllerV2.java:889 sets the sender from the token before the save.
        await expectStored(
          databases.for('kpost-api'),
          'common-send-message',
          {
            table: 'TBL_KPOST_KATCHUP_MESSAGES',
            where: { msg_id: msgID! },
            columns: {
              sender: A!.username,
              receiver: R!.username,
              message_type: KATCHUP_MESSAGE_TYPE.forwardSelectedAttachment,
              subject,
              attachment_path: (value: unknown) => JSON.stringify(value ?? '').includes(up!.uuid),
            },
            rule: 'common/sendMessage stores the forward-selected-attachments record from the logged-in user, with the picked attachment, whatever sender the body names',
          },
          endpoints,
        );
      } finally {
        await deleteMessages(endpoints, A!, forwarded, 'common-forward:cleanup-forward');
        await deleteMessages(endpoints, A!, original, 'common-forward:cleanup');
        await deleteUploaded(endpoints, A!, up?.uuid, 'common-forward:cleanup-file');
      }
    });
  },
);
