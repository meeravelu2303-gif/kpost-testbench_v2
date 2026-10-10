// Regression coverage for the IDOR/BOLA/disclosure findings confirmed live 2026-10-03 and filed as
// Bugzilla #952, #953, #954, #957, #958, #960, #961. Each test is the exact reproduction used to
// file its bug — kept here so a future run re-flags it automatically if the fix regresses or was
// never deployed, instead of relying on the one-off scratch files used during the original
// investigation (see docs/audits/katchup-ground-truth-2026-10-03.md §4 for the full writeup).
//
// #959 is deliberately NOT covered here: it was closed INVALID after the developer clarified that
// KPost's message history is intentionally account-scoped and device-independent (a user keeps
// access to anything they legitimately received, from any device, forever — unlike WhatsApp's
// device-local cache model). What looked like "a former group member can still fetch old history"
// is the correct, intended behavior for this product, not a bug.
/* eslint-disable playwright/no-conditional-in-test */
import { AUTH_PROFILES } from '@config/auth-profile';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { expect, test } from '@fixtures';

const K = AUTH_PROFILES.kpost;
const A = K.principals.find((p) => p.key === 'personal');
const B = K.principals.find((p) => p.key === 'victim');
const C = K.principals.find((p) => p.key === 'personal-3');

test.describe('KPost Security · Katchup IDOR/disclosure regression (2026-10-03 batch) @api @kpost-api @security @katchup', () => {
  test.skip(!A || !B || !C, 'needs three distinct KPost principals');
  test.skip(
    process.env.KATCHUP_LIFECYCLE !== 'true',
    'sends real messages / creates real groups; set KATCHUP_LIFECYCLE=true',
  );

  test('#952: a 1:1 message receiver cannot recall a message they only received @api @security', async ({
    endpoints,
  }) => {
    const marker = `QA regression-952 ${Date.now()}`;
    const sent = await endpoints.sendTo(
      'katchup-send-message',
      { body: sendShape({ receiver: B!.username, actualMessage: marker }) },
      { label: 'regression952:send', auth: { principal: A! }, allowLiveWrite: true },
    );
    const sentData = sent.json();
    const row = (sentData.ok
      ? ((sentData.value as Record<string, unknown>).data as Array<Record<string, unknown>> | undefined)?.[0]
      : undefined);
    const msgID = row?.msgID as number | undefined;
    test.skip(!msgID, `send did not return a msgID (replied ${sent.status})`);

    try {
      const attack = await endpoints.sendTo(
        'katchup-recall-message',
        { body: { msgID, groupFlag: false } },
        { label: 'regression952:attack', auth: { principal: B! }, allowLiveWrite: true },
      );
      const succeeded = attack.status < 300;
      if (succeeded) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'katchup-recall-message',
          ruleId: 'KPV2-RECEIVERRECALL',
          rule: 'recallMessage must only allow the original SENDER to recall a 1:1 message, never the receiver.',
          expected: 'a non-2xx rejection when the receiver (not the sender) attempts to recall',
          actual: `the receiver's recall replied ${attack.status}`,
          request: { body: { msgID, groupFlag: false } },
        });
      }
      expect
        .soft(succeeded, `#952: receiver-initiated recall must be refused (replied ${attack.status})`)
        .toBe(false);
    } finally {
      await endpoints
        .sendTo('katchup-delete-message', { body: { messageIds: [msgID], groupFlag: false } }, {
          label: 'regression952:cleanup',
          auth: { principal: A! },
          allowLiveWrite: true,
        })
        .catch(() => undefined);
    }
  });

  test('#953: getBulkMessageInfo must not reveal a message to an unrelated account @api @security', async ({
    endpoints,
  }) => {
    const marker = `QA regression-953 ${Date.now()}`;
    const sent = await endpoints.sendTo(
      'katchup-send-message',
      { body: sendShape({ receiver: B!.username, actualMessage: marker }) },
      { label: 'regression953:send', auth: { principal: A! }, allowLiveWrite: true },
    );
    const sentData = sent.json();
    const row = (sentData.ok
      ? ((sentData.value as Record<string, unknown>).data as Array<Record<string, unknown>> | undefined)?.[0]
      : undefined);
    const sharedMessageId = row?.sharedMessageId as number | undefined;
    const msgID = row?.msgID as number | undefined;
    test.skip(!sharedMessageId, `send did not return a sharedMessageId (replied ${sent.status})`);

    try {
      const attack = await endpoints.sendTo(
        'katchup-bulk-message-info',
        { body: { sharedMessageId } },
        { label: 'regression953:attack', auth: { principal: C! }, allowLiveRead: true },
      );
      const leaked = attack.status < 300 && attack.bodyText.includes(B!.username);
      if (leaked) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'katchup-bulk-message-info',
          ruleId: 'KPV2-BULKINFOIDOR',
          rule: 'getBulkMessageInfo must only return data to a sender or recipient of the underlying message.',
          expected: 'empty result or refusal for an unrelated caller',
          actual: `replied ${attack.status} with the real recipient's identity`,
          request: { body: { sharedMessageId } },
        });
      }
      expect
        .soft(leaked, `#953: an unrelated account must not see this message's recipient data (replied ${attack.status})`)
        .toBe(false);
    } finally {
      await endpoints
        .sendTo('katchup-delete-message', { body: { messageIds: [msgID], groupFlag: false } }, {
          label: 'regression953:cleanup',
          auth: { principal: A! },
          allowLiveWrite: true,
        })
        .catch(() => undefined);
    }
  });

  test('#954/#958: both reference-message-details endpoints must not reveal content to an unrelated account @api @security', async ({
    endpoints,
  }) => {
    const marker = `QA regression-954-958 ${Date.now()}`;
    const sent = await endpoints.sendTo(
      'katchup-send-message',
      { body: sendShape({ receiver: B!.username, actualMessage: marker }) },
      { label: 'regression954958:send', auth: { principal: A! }, allowLiveWrite: true },
    );
    const sentData = sent.json();
    const row = (sentData.ok
      ? ((sentData.value as Record<string, unknown>).data as Array<Record<string, unknown>> | undefined)?.[0]
      : undefined);
    const msgID = row?.msgID as number | undefined;
    test.skip(!msgID, `send did not return a msgID (replied ${sent.status})`);

    try {
      // #954 — getReferenceMSGDetails (singular "MSG")
      const attack954 = await endpoints.sendTo(
        'katchup-reference-details',
        { body: { referenceMessageIDList: [msgID], sourceMsgID: msgID } },
        { label: 'regression954:attack', auth: { principal: C! }, allowLiveRead: true },
      );
      const leaked954 = attack954.status < 300 && attack954.bodyText.includes(marker);
      if (leaked954) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'katchup-reference-details',
          ruleId: 'KPV2-REFDETAILSIDOR',
          rule: 'getReferenceMSGDetails must only return a message to a sender, receiver, or group member of it.',
          expected: 'the message content is withheld from an unrelated caller',
          actual: `replied ${attack954.status} with the real message text`,
          request: { body: { referenceMessageIDList: [msgID], sourceMsgID: msgID } },
        });
      }
      expect
        .soft(leaked954, `#954: getReferenceMSGDetails must not leak content to an unrelated account (replied ${attack954.status})`)
        .toBe(false);

      // #958 — getReferenceMessagesDetails (plural "Messages"), a DISTINCT backend method
      const attack958 = await endpoints.sendTo(
        'katchup-reference-messages-details',
        { body: { referenceMessageIDList: [msgID] } },
        { label: 'regression958:attack', auth: { principal: C! }, allowLiveRead: true },
      );
      const leaked958 = attack958.status < 300 && attack958.bodyText.includes(marker);
      if (leaked958) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'katchup-reference-messages-details',
          ruleId: 'KP-7A3C58',
          rule: 'getReferenceMessagesDetails must only return a message to a party to it (sibling of KPV2-REFDETAILSIDOR, independently unpatched).',
          expected: 'the message content is withheld from an unrelated caller',
          actual: `replied ${attack958.status} with the real message text`,
          request: { body: { referenceMessageIDList: [msgID] } },
        });
      }
      expect
        .soft(leaked958, `#958: getReferenceMessagesDetails must not leak content to an unrelated account (replied ${attack958.status})`)
        .toBe(false);
    } finally {
      await endpoints
        .sendTo('katchup-delete-message', { body: { messageIds: [msgID], groupFlag: false } }, {
          label: 'regression954958:cleanup',
          auth: { principal: A! },
          allowLiveWrite: true,
        })
        .catch(() => undefined);
    }
  });

  test('#957: getMessagesByReferenceMessageList must not reveal content to an unrelated account @api @security', async ({
    endpoints,
  }) => {
    const marker = `QA regression-957 ${Date.now()}`;
    const sent = await endpoints.sendTo(
      'katchup-send-message',
      { body: sendShape({ receiver: B!.username, actualMessage: marker }) },
      { label: 'regression957:send', auth: { principal: A! }, allowLiveWrite: true },
    );
    const sentData = sent.json();
    const row = (sentData.ok
      ? ((sentData.value as Record<string, unknown>).data as Array<Record<string, unknown>> | undefined)?.[0]
      : undefined);
    const msgID = row?.msgID as number | undefined;
    test.skip(!msgID, `send did not return a msgID (replied ${sent.status})`);

    try {
      const attack = await endpoints.sendTo(
        'katchup-messages-by-reference',
        { body: { referenceMessageList: JSON.stringify([{ ids: [msgID] }]), messageType: 20 } },
        { label: 'regression957:attack', auth: { principal: C! }, allowLiveRead: true },
      );
      const leaked = attack.status < 300 && attack.bodyText.includes(marker);
      if (leaked) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'katchup-messages-by-reference',
          ruleId: 'KP-9B2F41',
          rule: 'getMessagesByReferenceMessageList must only return a message to a party to it.',
          expected: 'the message content is withheld from an unrelated caller',
          actual: `replied ${attack.status} with the real message text`,
          request: { body: { referenceMessageList: JSON.stringify([{ ids: [msgID] }]), messageType: 20 } },
        });
      }
      expect
        .soft(leaked, `#957: getMessagesByReferenceMessageList must not leak content to an unrelated account (replied ${attack.status})`)
        .toBe(false);
    } finally {
      await endpoints
        .sendTo('katchup-delete-message', { body: { messageIds: [msgID], groupFlag: false } }, {
          label: 'regression957:cleanup',
          auth: { principal: A! },
          allowLiveWrite: true,
        })
        .catch(() => undefined);
    }
  });

  test('#960: downloading a group\'s profile image must require authentication @api @security', async ({
    endpoints,
  }) => {
    const created = await endpoints.sendTo(
      'group-create',
      {
        body: {
          activeStatus: 'Y',
          createdBy: A!.username,
          groupPicturePath: null,
          groupCreateAccess: true,
          groupKpostName: `Qreg Img ${Date.now()}`,
          isPrivateGroup: 'N',
          memberDetails: [{
            createdBy: A!.username,
            hasAdminAccess: 'Y',
            kpostID: A!.username,
            name: 'QA Bench',
            memberDesignation: '',
            privacyStatus: 'Y',
            remarks: 'created',
          }],
        },
      },
      { label: 'regression960:create', auth: { principal: A! }, allowLiveWrite: true },
    );
    const gData = created.json();
    const data = (gData.ok ? (gData.value as Record<string, unknown>).data : undefined) as
      Record<string, unknown> | undefined;
    const groupKpostID = data?.groupKpostID as string | undefined;
    const groupID = data?.groupID as number | undefined;
    test.skip(!groupKpostID, `group-create did not return a groupKpostID (replied ${created.status})`);

    try {
      const upload = await endpoints.sendTo(
        'group-update-image',
        {
          multipart: {
            file: {
              name: 'qa-bench.jpg',
              mimeType: 'image/jpeg',
              buffer: Buffer.from(
                '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
                'base64',
              ),
            },
            text: JSON.stringify({ groupKpostID }),
          },
        },
        { label: 'regression960:upload', auth: { principal: A! }, allowLiveWrite: true },
      );
      test.skip(upload.status >= 300, `image upload failed (replied ${upload.status})`);

      const anonThumb = await endpoints.sendTo(
        'group-download-image',
        { pathParams: { groupKpostID: groupKpostID!, kpostID: A!.username } },
        { label: 'regression960:anon-thumb', auth: { header: undefined }, allowLiveRead: true },
      );
      const leaked = anonThumb.status < 300;
      if (leaked) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'group-download-image',
          ruleId: 'KP-3F7D82',
          rule: 'Downloading a group profile image must require authentication.',
          expected: '401/403 for a request with no Authorization header',
          actual: `an anonymous request replied ${anonThumb.status}`,
          request: { pathParams: { groupKpostID: groupKpostID!, kpostID: A!.username } },
        });
      }
      expect
        .soft(leaked, `#960: an anonymous request must not download the group image (replied ${anonThumb.status})`)
        .toBe(false);
    } finally {
      if (groupID) {
        await endpoints
          .sendTo('group-delete', { body: { groupID } }, { label: 'regression960:cleanup-delete', auth: { principal: A! }, allowLiveWrite: true })
          .catch(() => undefined);
      }
    }
  });

  test('#961: getGroupDetailsUsingGroupKpostID must not disclose a private group\'s full record to a non-member @api @security', async ({
    endpoints,
  }) => {
    const created = await endpoints.sendTo(
      'group-create',
      {
        body: {
          activeStatus: 'Y',
          createdBy: A!.username,
          groupPicturePath: null,
          groupCreateAccess: true,
          groupKpostName: `Qreg Priv ${Date.now()}`,
          isPrivateGroup: 'Y',
          memberDetails: [{
            createdBy: A!.username,
            hasAdminAccess: 'Y',
            kpostID: A!.username,
            name: 'QA Bench',
            memberDesignation: '',
            privacyStatus: 'Y',
            remarks: 'created',
          }],
        },
      },
      { label: 'regression961:create', auth: { principal: A! }, allowLiveWrite: true },
    );
    const gData = created.json();
    const data = (gData.ok ? (gData.value as Record<string, unknown>).data : undefined) as
      Record<string, unknown> | undefined;
    const groupKpostID = data?.groupKpostID as string | undefined;
    const groupID = data?.groupID as number | undefined;
    test.skip(!groupKpostID, `group-create did not return a groupKpostID (replied ${created.status})`);

    try {
      const attack = await endpoints.sendTo(
        'group-details-by-id',
        { pathParams: { groupKpostID: groupKpostID! } },
        { label: 'regression961:attack', auth: { principal: C! }, allowLiveRead: true },
      );
      const leaked = attack.status < 300 && /passCode|memberDetails/.test(attack.bodyText);
      if (leaked) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'group-details-by-id',
          ruleId: 'KP-6D9A41',
          rule: 'getGroupDetailsUsingGroupKpostID must not disclose a private group\'s full record to a non-member, non-contact caller.',
          expected: 'the record (and especially passCode) is withheld from an unrelated caller',
          actual: `replied ${attack.status} with the full group record for a private group`,
          request: { pathParams: { groupKpostID: groupKpostID! } },
        });
      }
      expect
        .soft(leaked, `#961: a non-member must not receive this private group's full record (replied ${attack.status})`)
        .toBe(false);
    } finally {
      if (groupID) {
        await endpoints
          .sendTo('group-delete', { body: { groupID } }, { label: 'regression961:cleanup-delete', auth: { principal: A! }, allowLiveWrite: true })
          .catch(() => undefined);
      }
    }
  });
});
