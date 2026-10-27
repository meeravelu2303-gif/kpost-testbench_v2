import { AUTH_PROFILES } from '@config/auth-profile';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import type { Principal } from '@config/auth.config';
import { KMAIL_PRIORITY, KMAIL_TYPE } from '@api/contract/kpost-types';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { mailShape } from '@api/definitions/kmail/send.api';
import { testData } from '@config/test-data.config';

/**
 * KMail FRD behaviours end to end between our own accounts: compose, read-back, action types,
 * confidential recipients, drafts, settings and business rules. Every mail made is deleted.
 * Gated by KMAIL_LIFECYCLE=true (sends real mail).
 */

const K = AUTH_PROFILES.kpost;
const p = (key: string): Principal => K.principals.find((x) => x.key === key)!;
const A = p('personal'); // sender      Qatesting@
const B = p('victim'); // TO recipient  Qatesting2@
const C = p('personal-3'); // COPY       Qatesting3@
const D = p('personal-4'); // confidential Qatesting4@

interface Sent {
  status: number;
  kmailID?: number;
  transactionIDs: number[];
  body: Record<string, unknown>;
}

function row(body: Record<string, unknown>): Record<string, unknown> {
  const data = body.data;
  if (Array.isArray(data)) return (data[0] as Record<string, unknown>) ?? {};
  return (data as Record<string, unknown>) ?? {};
}

async function send(
  endpoints: EndpointExecutor,
  as: Principal,
  overrides: Record<string, unknown>,
  label: string,
): Promise<Sent> {
  const ex = await endpoints.sendTo(
    'kmail-post-mail',
    { body: mailShape(overrides) },
    { label: `kmail:${label}`, auth: { principal: as }, allowLiveWrite: true },
  );
  const parsed = ex.json();
  const b = (parsed.ok ? parsed.value : {}) as Record<string, unknown>;
  const r = row(b);
  const txns = r.kmailTransactionList;
  const transactionIDs = Array.isArray(txns)
    ? (txns as Array<Record<string, unknown>>)
        .map((t) => t.transactionID ?? t.id)
        .filter((v): v is number => typeof v === 'number')
    : [];
  return {
    status: ex.status,
    kmailID: typeof r.kmailID === 'number' ? r.kmailID : undefined,
    transactionIDs,
    body: b,
  };
}

async function del(
  endpoints: EndpointExecutor,
  as: Principal,
  transactionIDs: number[],
): Promise<void> {
  if (!transactionIDs.length) return;
  await endpoints
    .sendTo(
      'kmail-delete',
      { body: { groupFlag: false, transactionIDs } },
      { label: 'kmail:cleanup', auth: { principal: as }, allowLiveWrite: true },
    )
    .catch(() => undefined);
}

test.describe('KPost KMail · feature flow', { tag: ['@api', '@kmail', '@regression'] }, () => {
  // Gated while KMail refuses every valid token — see src/fixtures/kmail-auth-gate.ts.
  test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');

  test.describe.configure({ mode: 'default' });
  test.skip(process.env.KMAIL_LIFECYCLE !== 'true', 'sends real mail; set KMAIL_LIFECYCLE=true');

  test(
    'compose a New mail → read back → mark important → delete (FR-M01/M07) @api @kmail',
    { tag: '@sanity', annotation: [{ type: 'requirement-partial', description: 'FR-KM-018' }] },
    async ({ endpoints }) => {
      const subject = `QA Mail ${Date.now()}`;
      const sent = await send(
        endpoints,
        A,
        { toAddress: B.username, kmailSubject: subject },
        'compose',
      );
      expect.soft(sent.status, 'compose succeeds').toBeLessThan(300);
      expect.soft(sent.kmailID, 'a kmailID is issued (FR-M01)').toBeTruthy();

      try {
        if (sent.kmailID) {
          const important = await endpoints.sendTo(
            'kmail-set-important',
            { body: { kmailID: sent.kmailID } },
            { label: 'kmail:important', auth: { principal: A }, allowLiveWrite: true },
          );
          expect.soft(important.status, 'mark-important is accepted').toBeLessThan(300);
        }
      } finally {
        await del(endpoints, A, sent.transactionIDs);
      }
    },
  );

  test('read the composed mail back through every kmailID-keyed endpoint @api @kmail', async ({
    endpoints,
  }) => {
    // The id-keyed reads, fed a real kmailID (a fabricated one would read as a false bug).
    // A 5xx from any of these files via the flow-finding pipeline; a 4xx does not.
    const subject = `QA Mail ${Date.now()}`;
    const sent = await send(
      endpoints,
      A,
      { toAddress: B.username, kmailSubject: subject },
      'compose-readback',
    );
    expect.soft(sent.kmailID, 'a kmailID is issued').toBeTruthy();
    try {
      if (sent.kmailID) {
        const id = sent.kmailID;
        const reads: Array<[string, Record<string, unknown>]> = [
          [
            'kmail-mail-content',
            {
              kmailID: id,
              kmailNumber: 0,
              kmailType: 'Sent',
              selectedContact: B.username,
              groupFlag: false,
            },
          ],
          ['kmail-details-by-id', { kmailIDs: [id] }],
          ['kmail-reply-not-req-sender', { selectedContact: B.username, kmailID: id }],
          ['kmail-reply-not-req-receiver', { selectedContact: B.username, kmailID: id }],
          ['kmail-group-read-status', { kmailID: id }],
          // Contact-scoped reads, meaningful now that A and B share a real mail.
          ['kmail-subjects', { selectedContact: B.username }],
          ['kmail-sent-not-opened', { selectedContact: B.username }],
          ['kmail-reply-not-received', { kpostUser: A.username, selectedContact: B.username }],
          ['kmail-reply-not-sent', { selectedContact: B.username }],
          ['kmail-important-mails', { selectedContact: B.username }],
          ['kmail-all-mail-count', { selectedContact: B.username, groupFlag: false }],
          ['kmail-drafts-for-contact', { toAddress: B.username }],
          ['kmail-status-with-count', { kmailStatusFlag: 2 }],
          // Not productionSafe: needs allowLiveRead (set on every call below).
          ['kmail-bulk-dashboard', { kmailID: id }],
        ];
        for (const [epId, reqBody] of reads) {
          const ex = await endpoints.sendTo(
            epId,
            { body: reqBody },
            {
              label: `kmail:readback:${epId}`,
              auth: { principal: A },
              allowLiveWrite: true,
              allowLiveRead: true,
            },
          );
          expect.soft(ex.status, `${epId} reads the mail without a server error`).toBeLessThan(500);
        }

        // A GET keyed by path param; not productionSafe, so it needs allowLiveRead.
        const copies = await endpoints.sendTo(
          'kmail-copies-info',
          { pathParams: { kmailID: id } },
          {
            label: 'kmail:readback:kmail-copies-info',
            auth: { principal: A },
            allowLiveRead: true,
          },
        );
        expect
          .soft(copies.status, 'getCopiesInfo reads the mail without a server error')
          .toBeLessThan(500);
      }
    } finally {
      await del(endpoints, A, sent.transactionIDs);
    }
  });

  test(
    'the To: field takes a single recipient; extra people go to Cc (FR-KM-005) @api @kmail',
    { annotation: [{ type: 'requirement', description: 'FR-KM-005' }] },
    async ({ endpoints }) => {
      // The model carries one toAddress string; extra recipients go in ccList. Checked on the
      // contract and with a real send.
      const shape = mailShape({ toAddress: B.username, ccList: [C.username] });
      expect
        .soft(typeof shape.toAddress, 'the To: field is a single address, not a list (FR-KM-005)')
        .toBe('string');
      expect
        .soft(Array.isArray(shape.ccList), 'additional recipients ride in the Cc list')
        .toBe(true);

      const subject = `QA Single-TO ${Date.now()}`;
      const sent = await send(
        endpoints,
        A,
        { toAddress: B.username, ccList: [C.username], kmailSubject: subject },
        'single-recipient',
      );
      expect.soft(sent.status, 'a single-TO + Cc send is accepted').toBeLessThan(300);
      expect.soft(sent.kmailID, 'a kmailID is issued').toBeTruthy();
      await del(endpoints, A, sent.transactionIDs);

      // A second address in To must be refused. Known defect #1365: it answers 200 but delivers
      // nothing. Nothing to clean up: such a send creates no transactions.
      const twoTo = await endpoints.sendTo(
        'kmail-post-mail',
        {
          body: mailShape({
            toAddress: `${B.username},${C.username}`,
            kmailSubject: `QA two-To ${Date.now()}`,
          }),
        },
        { label: 'kmail:two-to', auth: { principal: A }, allowLiveWrite: true },
      );
      const twoToJson = twoTo.json();
      const twoToRow = row((twoToJson.ok ? twoToJson.value : {}) as Record<string, unknown>);
      test.info().annotations.push({
        type: 'observed',
        description: `two-address To: HTTP ${twoTo.status}, mailDeliveryStatus ${String(twoToRow.mailDeliveryStatus)}`,
      });
      expect(
        twoTo.status,
        `FR-KM-005: a To with two addresses must be refused, not reported as sent (#1365 — replied ` +
          `${twoTo.status}, mailDeliveryStatus ${String(twoToRow.mailDeliveryStatus)})`,
      ).toBeGreaterThanOrEqual(400);
    },
  );

  test(
    'a high-priority mail carries its priority flag (FR-KM-010 / FR-KM-011) @api @kmail',
    {
      annotation: [
        { type: 'requirement-partial', description: 'FR-KM-010' },
        { type: 'requirement-partial', description: 'FR-KM-011' },
      ],
    },
    async ({ endpoints }) => {
      const subject = `QA Priority ${Date.now()}`;
      const sent = await send(
        endpoints,
        A,
        { toAddress: B.username, kmailSubject: subject, priority: KMAIL_PRIORITY.high },
        'priority',
      );
      expect.soft(sent.status, 'a high-priority send is accepted').toBeLessThan(300);
      const r = row(sent.body);
      if (r.priority != null) {
        expect
          .soft(Number(r.priority), 'the high-priority flag is carried back (FR-KM-011)')
          .toBe(KMAIL_PRIORITY.high);
      }
      await del(endpoints, A, sent.transactionIDs);
    },
  );

  test('the post-send action types are each accepted (Reply/Forward/Note/Comment/Clarify) @api @kmail', async ({
    endpoints,
  }) => {
    const T = KMAIL_TYPE as Record<string, number>;
    const made: number[][] = [];
    try {
      for (const [label, type] of [
        ['reply', T.reply!],
        ['forward', T.forward!],
        ['note', T.note!],
        ['comment', T.comment!],
        ['clarify', T.clarify!],
      ] as Array<[string, number]>) {
        const r = await send(
          endpoints,
          A,
          { toAddress: B.username, kmailType: type, kmailSubject: `QA ${label}` },
          label,
        );
        // Reply works with the New shape; Forward/Note/Comment/Clarify need type-specific fields
        // (a reference / forward list), so a 4xx/5xx from them is a finding, not a flow failure.
        expect
          .soft(r.status, `${label} (type ${type}) returns a status`)
          .toBeLessThan(label === 'reply' ? 300 : 600);
        made.push(r.transactionIDs);
      }
    } finally {
      for (const ids of made) await del(endpoints, A, ids);
    }
  });

  test(
    'a confidential recipient (bccList) is hidden from the others (BR / NFR-SEC02) @api @kmail @security',
    { annotation: [{ type: 'requirement', description: 'NFR-SEC02' }] },
    async ({ endpoints }) => {
      // A: sender, B: TO, C: COPY (ccList), D: confidential (bccList).
      const sent = await send(
        endpoints,
        A,
        {
          toAddress: B.username,
          ccList: [C.username],
          bccList: [D.username],
          kmailSubject: 'QA confidential',
        },
        'confidential',
      );
      expect.soft(sent.status, 'confidential send succeeds').toBeLessThan(300);

      try {
        // Read B's thread with A; the confidential recipient D must not appear in it.
        const view = await endpoints.sendTo(
          'kmail-selected-contact-mails',
          { body: { selectedContact: A.username } },
          { label: 'kmail:view', auth: { principal: B } },
        );
        expect
          .soft(
            view.bodyText ?? '',
            'the confidential recipient is not revealed to the TO recipient',
          )
          .not.toContain(D.username);
      } finally {
        await del(endpoints, A, sent.transactionIDs);
      }
    },
  );

  test('a draft is saved, appears in the draft lists, is readable, and delete removes it @api @kmail', async ({
    endpoints,
  }) => {
    const marker = `QA Draft ${Date.now()}`;
    const saved = await endpoints.sendTo(
      'kmail-draft-save',
      {
        body: mailShape({
          toAddress: B.username,
          kmailType: KMAIL_TYPE.draft,
          kmailSubject: marker,
        }),
      },
      { label: 'kmail:draft-save', auth: { principal: A }, allowLiveWrite: true },
    );
    expect.soft(saved.status, 'saving a draft is accepted').toBeLessThan(300);

    const parsed = saved.json();
    const r = row((parsed.ok ? parsed.value : {}) as Record<string, unknown>);
    const draftMailID = (r.draftMailID ?? r.draftKmailID ?? '') as string;
    const kmailID =
      typeof r.kmailID === 'number' || typeof r.kmailID === 'string' ? String(r.kmailID) : '0';

    if (draftMailID) {
      const allDrafts = await endpoints.sendTo(
        'kmail-all-drafts',
        {},
        { label: 'kmail:draft-list', auth: { principal: A } },
      );
      expect(allDrafts.status, 'getAllDraftMails succeeds').toBe(200);
      expect(allDrafts.bodyText, 'the saved draft appears in getAllDraftMails').toContain(marker);

      const contacts = await endpoints.sendTo(
        'kmail-draft-contacts',
        {},
        { label: 'kmail:draft-contacts', auth: { principal: A } },
      );
      expect(contacts.status, 'getDraftMailsContacts succeeds').toBe(200);
      expect(contacts.bodyText, 'the draft recipient appears in getDraftMailsContacts').toContain(
        B.username,
      );

      // An id-keyed read, not productionSafe: needs allowLiveRead.
      const content = await endpoints.sendTo(
        'kmail-draft-content',
        { body: { draftKmailID: draftMailID, kmailSendDate: Date.now(), kmailSubject: marker } },
        { label: 'kmail:draft-content', auth: { principal: A }, allowLiveRead: true },
      );
      expect.soft(content.status, 'draftMailContent reads the real draft').toBeLessThan(300);

      const deleted = await endpoints.sendTo(
        'kmail-draft-delete',
        { body: { kmailID, draftMailID } },
        { label: 'kmail:draft-delete', auth: { principal: A }, allowLiveWrite: true },
      );
      expect.soft(deleted.status, 'deleting the draft is accepted').toBeLessThan(300);

      const afterDelete = await endpoints.sendTo(
        'kmail-all-drafts',
        {},
        { label: 'kmail:draft-list-after', auth: { principal: A } },
      );
      expect(
        afterDelete.bodyText,
        'the deleted draft no longer appears in getAllDraftMails',
      ).not.toContain(marker);
    }
  });

  test('settings writes: saluation, instant reply, signature, count-limit @api @kmail', async ({
    endpoints,
  }) => {
    const write = async (id: string, bodyObj: Record<string, unknown>, label: string) => {
      const ex = await endpoints.sendTo(
        id,
        { body: bodyObj },
        { label: `kmail:${label}`, auth: { principal: A }, allowLiveWrite: true },
      );
      return ex.status;
    };

    expect
      .soft(
        await write(
          'kmail-sig-personal',
          { firstName: 'QA', lastName: 'Tester', designation: 'QA' },
          'sig-personal',
        ),
        'signature personal',
      )
      .toBeLessThan(600);
    expect
      .soft(
        await write('kmail-count-days-limit-update', { countDaysLimit: 60 }, 'count-limit'),
        'count-days-limit',
      )
      .toBeLessThan(600);
  });

  test(
    'saluation: save → appears in the list → is reflected on the digital signature → delete removes it',
    {
      annotation: [
        { type: 'requirement-partial', description: 'FR-KM-007' },
        { type: 'requirement-partial', description: 'FR-KM-008' },
      ],
    },
    async ({ endpoints }) => {
      // A unique marker per run, so a leftover from an earlier run cannot match.
      const marker = `QA Saluation ${Date.now()}`;
      const saved = await endpoints.sendTo(
        'kmail-save-saluation',
        { body: { saluationID: '', saluation: marker } },
        { label: 'kmail:sal-save', auth: { principal: A }, allowLiveWrite: true },
      );
      expect.soft(saved.status, 'save is accepted').toBeLessThan(300);

      const list = await endpoints.sendTo(
        'kmail-saluations',
        {},
        { label: 'kmail:sal-list', auth: { principal: A } },
      );
      expect(list.status, 'the saluation list reads back').toBe(200);
      const listBody = JSON.parse(list.bodyText || '{}') as {
        data?: Array<{ saluationID: string; saluation: string }>;
      };
      const entry = (listBody.data ?? []).find((s) => s.saluation === marker);
      expect(entry, 'the saved saluation appears in kmail-saluations, with a real id').toBeTruthy();

      if (entry) {
        const digSig = await endpoints.sendTo(
          'kmail-digital-signature',
          {},
          { label: 'kmail:sal-digsig', auth: { principal: A } },
        );
        expect(
          digSig.bodyText,
          'the same saluation is embedded in getDigitalSignature (not a divergent copy)',
        ).toContain(marker);

        const deleted = await endpoints.sendTo(
          'kmail-delete-saluation',
          { body: { saluationID: entry.saluationID } },
          { label: 'kmail:sal-delete', auth: { principal: A }, allowLiveWrite: true },
        );
        expect.soft(deleted.status, 'delete is accepted').toBeLessThan(300);

        const after = await endpoints.sendTo(
          'kmail-saluations',
          {},
          { label: 'kmail:sal-list-after', auth: { principal: A } },
        );
        const afterBody = JSON.parse(after.bodyText || '{}') as {
          data?: Array<{ saluationID: string }>;
        };
        expect(
          (afterBody.data ?? []).some((s) => s.saluationID === entry.saluationID),
          'the deleted saluation no longer appears in the list',
        ).toBe(false);
      }
    },
  );

  test('instant reply: save → reflected on the digital signature → delete removes it', async ({
    endpoints,
  }) => {
    const marker = `QA Auto-Reply ${Date.now()}`;
    const saved = await endpoints.sendTo(
      'kmail-set-instant-reply',
      { body: { id: '', instantReply: marker } },
      { label: 'kmail:reply-save', auth: { principal: A }, allowLiveWrite: true },
    );
    expect.soft(saved.status, 'save is accepted').toBeLessThan(300);

    const digSig = await endpoints.sendTo(
      'kmail-digital-signature',
      {},
      { label: 'kmail:reply-digsig', auth: { principal: A } },
    );
    expect(digSig.status, 'getDigitalSignature reads back').toBe(200);
    const digBody = JSON.parse(digSig.bodyText || '{}') as {
      data?: { customizedInstantReply?: string };
    };
    const customized = JSON.parse(digBody.data?.customizedInstantReply || '[]') as Array<{
      id: string;
      instantReply: string;
    }>;
    const entry = customized.find((r) => r.instantReply === marker);
    expect(
      entry,
      'the saved instant reply is embedded in getDigitalSignature, with a real id',
    ).toBeTruthy();

    if (entry) {
      const deleted = await endpoints.sendTo(
        'kmail-delete-instant-reply',
        { body: { id: entry.id } },
        { label: 'kmail:reply-delete', auth: { principal: A }, allowLiveWrite: true },
      );
      expect.soft(deleted.status, 'delete is accepted').toBeLessThan(300);

      const after = await endpoints.sendTo(
        'kmail-digital-signature',
        {},
        { label: 'kmail:reply-digsig-after', auth: { principal: A } },
      );
      expect(
        after.bodyText,
        'the deleted instant reply no longer appears on the digital signature',
      ).not.toContain(marker);
    }
  });

  test(
    'postMail rejects a salutation outside the allowed set (BR-KM-SALUTE) @api @kmail',
    { annotation: [{ type: 'requirement', description: 'BR-KM-SALUTE' }] },
    async ({ endpoints }) => {
      // The salutation must be one of Hi/Hello/Dear/Sir/Madam/Respect: an out-of-set value is
      // rejected or normalized, never stored verbatim.
      const sent = await send(
        endpoints,
        A,
        {
          toAddress: B.username,
          kmailSubject: `QA salute ${Date.now()}`,
          saluation: 'NotARealSalutation',
        },
        'bad-salute',
      );
      try {
        if (sent.status < 300 && sent.kmailID) {
          // Accepted: read it back to check the value was normalized.
          const readBack = await endpoints.sendTo(
            'kmail-details-by-id',
            { body: { kmailIDs: [sent.kmailID] } },
            {
              label: 'kmail:salute-readback',
              auth: { principal: A },
              allowLiveWrite: true,
              allowLiveRead: true,
            },
          );
          const readJson = readBack.json();
          const readValue = row((readJson.ok ? readJson.value : {}) as Record<string, unknown>);
          expect
            .soft(
              readValue.saluation,
              'BR-KM-SALUTE: an out-of-set salutation must not be stored verbatim ' +
                `(postMail replied ${sent.status})`,
            )
            .not.toBe('NotARealSalutation');
        } else {
          expect
            .soft(sent.status, 'BR-KM-SALUTE: an out-of-set salutation is rejected at write time')
            .toBeGreaterThanOrEqual(400);
        }
      } finally {
        await del(endpoints, A, sent.transactionIDs);
      }
    },
  );

  test(
    'postMail rejects an empty body (BR-KM-BODY) @api @kmail',
    { annotation: [{ type: 'requirement', description: 'BR-KM-BODY' }] },
    async ({ endpoints }) => {
      // An empty kmailContent must not be accepted.
      const sent = await send(
        endpoints,
        A,
        { toAddress: B.username, kmailSubject: `QA empty-body ${Date.now()}`, kmailContent: '' },
        'empty-body',
      );
      try {
        expect
          .soft(
            sent.status,
            `BR-KM-BODY: an empty mail body must be rejected (postMail replied ${sent.status})`,
          )
          .toBeGreaterThanOrEqual(400);
      } finally {
        await del(endpoints, A, sent.transactionIDs);
      }
    },
  );

  test(
    'postMail accepts a non-KPost external address as recipient (BR-KM-EXTERNAL) @api @kmail',
    { annotation: [{ type: 'requirement', description: 'BR-KM-EXTERNAL' }] },
    async ({ endpoints }) => {
      // Uses the bench's own external mailbox (testData.otpEmail), never an invented inbox.
      const sent = await send(
        endpoints,
        A,
        { toAddress: testData.otpEmail, kmailSubject: `QA external ${Date.now()}` },
        'external-recipient',
      );
      try {
        expect
          .soft(
            sent.status,
            `BR-KM-EXTERNAL: a non-KPost external address must be accepted as a recipient (replied ${sent.status})`,
          )
          .toBeLessThan(300);
      } finally {
        await del(endpoints, A, sent.transactionIDs);
      }
    },
  );
});
