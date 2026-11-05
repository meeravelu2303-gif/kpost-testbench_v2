import { KMAIL_PRIORITY, KMAIL_RECEIVER_TYPE, KMAIL_TYPE } from '@api/contract/kpost-types';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import {
  A,
  B,
  C,
  call,
  deleteEverywhere,
  marker,
  sendMail,
  threadRow,
} from '../support/kmail-rules';

/**
 * KMail send (postMail) input rules the engine's per-field cases do not reach, read from the KMail
 * backend (D:\KPOST_PROJECTS\Kpost_Kmail_5.0, branch kmail5_qa): SentMailController.postMail →
 * @Validated(PostMailValidation) on SentMailRequestObject, then SentMailServiceImpl.postMail. Every
 * recipient is one of our own QA accounts (A sends, B is To, C is Cc); every mail that gets sent
 * is deleted from every side afterwards. Gated by KMAIL_LIFECYCLE=true like the KMail flows.
 * (External recipients — FR-KM-022 — are covered by e2e/kmail-lifecycle-e2e.spec.ts BR-KM-EXTERNAL; a second
 * To address — FR-KM-005, #1365 — by e2e/kmail-lifecycle-e2e.spec.ts too.)
 */

test.describe('KMail send · input rules', { tag: ['@api', '@kmail', '@regression'] }, () => {
  test.describe.configure({ mode: 'default', timeout: 120_000 });
  test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
  test.skip(
    process.env.KMAIL_LIFECYCLE !== 'true',
    'sends real KMail between our accounts; set KMAIL_LIFECYCLE=true',
  );
  test.skip(
    !testData.kpostId || !testData.victimKpostId || !testData.personal3KpostId,
    'needs three QA accounts',
  );

  test(
    'a New mail with no recipient is refused and nothing is sent',
    { annotation: [{ type: 'requirement-partial', description: 'FR-KM-018' }] },
    async ({ endpoints }) => {
      // RequiredMailRecipientValidator.java:26 (via @RequiredMailRecipient, SentMailRequestObject.java:37).
      const sent = await sendMail(
        endpoints,
        { toAddress: '', kmailSubject: marker('no-recipient') },
        'send-rules:no-recipient',
      );
      try {
        if (sent.reply.status < 400) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'kmail-post-mail',
            ruleId: 'KMAIL-recipient-required',
            rule: 'postMail must refuse a New mail with an empty toAddress (RequiredMailRecipientValidator).',
            expected: '400, no mail created',
            actual: `postMail answered ${sent.reply.status}; kmailID ${sent.kmailID ?? 'none'}`,
            request: { body: sent.body },
          });
        }
        expect.soft(sent.reply.status, 'an empty To is refused with 400').toBe(400);
        expect.soft(sent.kmailID, 'no mail is created').toBeUndefined();
      } finally {
        await deleteEverywhere(endpoints, sent.kmailID);
      }
    },
  );

  test(
    'a Forward with an empty forward list is refused',
    { annotation: [{ type: 'requirement-partial', description: 'FR-KM-018' }] },
    async ({ endpoints }) => {
      // RequiredMailRecipientValidator.java:22-24: a Forward needs a non-empty forwardList.
      const sent = await sendMail(
        endpoints,
        { kmailType: KMAIL_TYPE.forward, forwardList: [], kmailSubject: marker('fwd-empty') },
        'send-rules:forward-empty',
      );
      try {
        if (sent.reply.status < 400) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'kmail-post-mail',
            ruleId: 'KMAIL-forward-list-required',
            rule: 'postMail must refuse a Forward (kmailType 2) whose forwardList is empty (RequiredMailRecipientValidator).',
            expected: '400, nothing forwarded',
            actual: `postMail answered ${sent.reply.status}; kmailID ${sent.kmailID ?? 'none'}`,
            request: { body: sent.body },
          });
        }
        expect.soft(sent.reply.status, 'a Forward with no forward list is refused').toBe(400);
      } finally {
        await deleteEverywhere(endpoints, sent.kmailID);
      }
    },
  );

  test(
    'a whitespace-only subject or body is refused',
    {
      annotation: [
        { type: 'requirement-partial', description: 'FR-KM-009' },
        { type: 'requirement-partial', description: 'FR-KM-012' },
      ],
    },
    async ({ endpoints }) => {
      // @NotBlank kmailSubject / kmailContent (SentMailRequestObject.java:58, :105).
      for (const [label, overrides] of [
        ['subject', { kmailSubject: '   ' }],
        ['body', { kmailSubject: marker('blank-body'), kmailContent: '   ' }],
      ] as Array<[string, Record<string, unknown>]>) {
        const sent = await sendMail(endpoints, overrides, `send-rules:blank-${label}`);
        try {
          if (sent.reply.status < 400) {
            endpoints.recordBusinessRuleViolation({
              endpointId: 'kmail-post-mail',
              ruleId: `KMAIL-${label}-not-blank`,
              rule: `postMail must refuse a whitespace-only ${label} (@NotBlank on SentMailRequestObject).`,
              expected: '400, no mail created',
              actual: `postMail answered ${sent.reply.status}; kmailID ${sent.kmailID ?? 'none'}`,
              request: { body: sent.body },
            });
          }
          expect.soft(sent.reply.status, `a whitespace-only ${label} is refused`).toBe(400);
        } finally {
          await deleteEverywhere(endpoints, sent.kmailID);
        }
      }
    },
  );

  test(
    'a malformed recipient address is refused, not sent',
    { annotation: [{ type: 'requirement-partial', description: 'FR-KM-022' }] },
    async ({ endpoints }) => {
      // The web composer refuses a malformed address (FR-KM-022 alternative flow); postMail itself
      // checks only commas/semicolons, duplicates and blocks (SentMailServiceImpl.java:253-487).
      // Two @ signs: not an address any mail server can route.
      const bad = 'qa.bench.malformed@@kpostindia';
      const sent = await sendMail(
        endpoints,
        { toAddress: bad, kmailSubject: marker('malformed') },
        'send-rules:malformed',
        [bad],
      );
      try {
        if (sent.reply.status < 400) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'kmail-post-mail',
            ruleId: 'KMAIL-recipient-well-formed',
            rule: 'postMail must refuse a recipient that is not a valid e-mail address (no syntax check in SentMailServiceImpl.postMail).',
            expected: 'a 4xx naming the address, no mail created',
            actual: `postMail answered ${sent.reply.status} for "${bad}"; kmailID ${sent.kmailID ?? 'none'}`,
            request: { body: sent.body },
          });
        }
        expect.soft(sent.reply.status, 'a malformed To is refused').toBeGreaterThanOrEqual(400);
        expect.soft(sent.reply.status, 'and not with a server error').toBeLessThan(500);
        expect.soft(sent.kmailID, 'no mail is created').toBeUndefined();
      } finally {
        await deleteEverywhere(endpoints, sent.kmailID, [], bad, [bad]);
      }
    },
  );

  test(
    'a mail to yourself is refused',
    { annotation: [{ type: 'requirement-partial', description: 'FR-KM-018' }] },
    async ({ endpoints }) => {
      // From == To falls into the duplicate branch: 400 (SentMailServiceImpl.java:263, :480-486).
      const sent = await sendMail(
        endpoints,
        { toAddress: A.username, kmailSubject: marker('self') },
        'send-rules:self',
      );
      try {
        expect.soft(sent.reply.status, 'sending to your own address is refused').toBe(400);
      } finally {
        await deleteEverywhere(endpoints, sent.kmailID, [], A.username);
      }
    },
  );

  test(
    'the same person in To and Cc is refused, whatever the letter case',
    { annotation: [{ type: 'requirement-partial', description: 'FR-KM-006' }] },
    async ({ endpoints }) => {
      // Cc and Bcc are compared case-insensitively with From and To (SentMailServiceImpl.java:263-270).
      for (const cc of [B.username, B.username.toUpperCase()]) {
        const sent = await sendMail(
          endpoints,
          { ccList: [cc], kmailSubject: marker('to-cc-dup') },
          'send-rules:to-cc-duplicate',
          [cc],
        );
        try {
          expect
            .soft(sent.reply.status, `To ${B.username} with Cc ${cc} is refused with 400`)
            .toBe(400);
        } finally {
          await deleteEverywhere(endpoints, sent.kmailID);
        }
      }
    },
  );

  test(
    'a person listed twice in the copies receives the mail once',
    { annotation: [{ type: 'requirement-partial', description: 'FR-KM-006' }] },
    async ({ endpoints }) => {
      // SentMailServiceImpl.java:263-270 compares each copy only with From and To, never Cc with Cc
      // or Cc with Bcc: correct behaviour is a refusal or a single delivery.
      for (const [label, overrides] of [
        ['cc-twice', { ccList: [C.username, C.username] }],
        ['cc-and-bcc', { ccList: [C.username], bccList: [C.username] }],
      ] as Array<[string, Record<string, unknown>]>) {
        const sent = await sendMail(
          endpoints,
          { ...overrides, kmailSubject: marker(label) },
          `send-rules:${label}`,
        );
        try {
          if (sent.reply.status >= 400) {
            expect.soft(sent.reply.status, `${label}: a refusal is a 4xx`).toBeLessThan(500);
            continue;
          }
          expect(sent.kmailID, `${label}: the mail is sent`).toBeDefined();
          const row = await threadRow(endpoints, A, B.username, sent.kmailID!);
          const copies = (row?.kmailTransactionList ?? []).filter(
            (t) => t.receiver.toLowerCase() === C.username.toLowerCase(),
          ).length;
          if (copies > 1) {
            endpoints.recordBusinessRuleViolation({
              endpointId: 'kmail-post-mail',
              ruleId: 'KMAIL-recipient-once',
              rule: 'postMail must deliver to each person once (or refuse the duplicate, as it does for To/Cc); it does not compare copies with each other.',
              expected: `${C.username} receives one copy, or a 400`,
              actual: `postMail answered ${sent.reply.status}; ${C.username} has ${copies} transactions on kmailID ${sent.kmailID}`,
              request: { body: sent.body },
            });
          }
          expect.soft(copies, `${label}: ${C.username} receives the mail once`).toBe(1);
        } finally {
          await deleteEverywhere(endpoints, sent.kmailID, [B, C]);
        }
      }
    },
  );

  test(
    'a sent mail reads back exactly as sent: subject, priority, copies and body',
    {
      annotation: [
        { type: 'requirement-partial', description: 'FR-KM-009' },
        { type: 'requirement-partial', description: 'FR-KM-010' },
        { type: 'requirement-partial', description: 'FR-KM-012' },
        { type: 'requirement-partial', description: 'FR-KM-018' },
      ],
    },
    async ({ endpoints }) => {
      const subject = marker('readback');
      const content = `QA bench read-back body ${Date.now()} — safe to ignore.`;
      const sent = await sendMail(
        endpoints,
        {
          kmailSubject: subject,
          kmailContent: content,
          ccList: [C.username],
          priority: KMAIL_PRIORITY.high,
        },
        'send-rules:readback',
      );
      try {
        expect(sent.reply.status, `the mail sends: ${sent.reply.text.slice(0, 200)}`).toBe(200);
        expect(sent.kmailID, 'a kmailID is issued').toBeDefined();
        const asB = await threadRow(endpoints, B, A.username, sent.kmailID!);
        expect(asB, 'the To recipient has the mail').toBeTruthy();
        expect.soft(asB?.kmailSubject, 'the subject arrives unchanged').toBe(subject);
        expect.soft(asB?.priority, 'the priority arrives unchanged').toBe(KMAIL_PRIORITY.high);
        const cc = asB?.kmailTransactionList.find(
          (t) => t.receiver.toLowerCase() === C.username.toLowerCase(),
        );
        expect
          .soft(cc?.receiverType, 'the Cc recipient is listed as a copy')
          .toBe(KMAIL_RECEIVER_TYPE.receiverTypeCopy);
        const body = await call(
          endpoints,
          'kmail-mail-content',
          B,
          {
            kmailID: sent.kmailID,
            kmailNumber: 0,
            kmailType: 'Received',
            selectedContact: A.username,
            groupFlag: false,
          },
          'send-rules:readback-content',
        );
        expect.soft(body.status, 'the recipient can open the mail').toBe(200);
        expect.soft(body.text, 'the body arrives unchanged').toContain(content);
      } finally {
        await deleteEverywhere(endpoints, sent.kmailID, [B, C]);
      }
    },
  );
});
