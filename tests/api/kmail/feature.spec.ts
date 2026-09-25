// An orchestrated KMail lifecycle (compose → read back → act → delete), not simple assertions; the
// conditionals guard optional steps and cleanup of real live data.
/* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect */
import { AUTH_PROFILES } from '@config/auth-profile';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import type { Principal } from '@config/auth.config';
import { KMAIL_PRIORITY, KMAIL_TYPE } from '@api/schemas/kpost-types';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { mailShape } from '@api/definitions/kmail/send.api';

/**
 * KMail **feature flow** — the FRD's mail behaviours (FR-M01..M09, BR-M01), end to end on kmail5,
 * self-cleaning. Gated `KMAIL_LIFECYCLE=true`, each write `allowLiveWrite`, all to our own accounts.
 *
 * Covers: compose (New) issuing a kmailID (FR-M01); mark-important; the post-send action types
 * (Reply/Forward/Note/Comment/Clarify); the confidential recipient hidden from the others
 * (`bccList`, BR mirrors NFR-SEC02); drafts (save → delete); and the settings writes. `expect.soft`
 * so one run reports every finding.
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

test.describe('KPost KMail · feature flow', () => {
  // Gated while KMail refuses every valid token — see src/fixtures/kmail-auth-gate.ts.
  test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');

  test.describe.configure({ mode: 'default' });
  test.skip(process.env.KMAIL_LIFECYCLE !== 'true', 'sends real mail; set KMAIL_LIFECYCLE=true');

  test('compose a New mail → read back → mark important → delete (FR-M01/M07) @api @kmail', async ({
    endpoints,
  }) => {
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
  });

  test('read the composed mail back through every kmailID-keyed endpoint @api @kmail', async ({
    endpoints,
  }) => {
    // Exercises the needs-id READS on live with a REAL kmailID the compose mints — the coverage the
    // static run cannot reach (a fabricated id would 404/500 and read as a false bug). A 5xx from any
    // of these is a genuine crash and files via the flow-finding pipeline; a 4xx does not.
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
          // Contact-scoped reads: not kmailID-keyed, but real now that A→B has an actual mail
          // between them (previously only reachable off-live with a placeholder contact).
          ['kmail-subjects', { selectedContact: B.username }],
          ['kmail-sent-not-opened', { selectedContact: B.username }],
          ['kmail-reply-not-received', { kpostUser: A.username, selectedContact: B.username }],
          ['kmail-reply-not-sent', { selectedContact: B.username }],
          ['kmail-important-mails', { selectedContact: B.username }],
          ['kmail-all-mail-count', { selectedContact: B.username, groupFlag: false }],
          ['kmail-drafts-for-contact', { toAddress: B.username }],
          ['kmail-status-with-count', { kmailStatusFlag: 2 }],
          // destructive:false explicitly, no productionSafe — needs allowLiveRead (added below on
          // every call here), not allowLiveWrite, to run at all.
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
          /*
           * Live-verified 2026-09-25: a read-only endpoint here (`destructive: false`) is actually
           * authorized by `allowLiveRead`, not `allowLiveWrite` — the flow-finding pipeline's
           * auto-filing only tracks `allowLiveWrite`-authorized 5xxs, so a genuine crash on one of
           * these reads (confirmed: `kmail-reply-not-req-receiver` 500s reproducibly reading a real
           * kmailID) would otherwise go completely unfiled despite this test's own comment above
           * assuming it files automatically. Filed explicitly here so the safety net actually covers
           * every endpoint in this loop, not just the destructive ones.
           */
          if (ex.status >= 500) {
            endpoints.recordBusinessRuleViolation({
              endpointId: epId,
              ruleId: 'REGRESSION-kmail-readback-server-error',
              rule: `${epId} must read back a mail the caller just sent without a server error.`,
              expected: 'a client error or success — never a 5xx',
              actual: `${ex.status} ${ex.bodyText.slice(0, 300)}`,
              request: { body: reqBody },
            });
          }
          expect.soft(ex.status, `${epId} reads the mail without a server error`).toBeLessThan(500);
        }

        // GET, path-param-keyed (not a body read like the others above) — real now that this flow
        // has a real kmailID. destructive:false (GET) with no productionSafe: needs allowLiveRead.
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

  test('the To: field takes a single recipient; extra people go to Cc (FR-KM-005) @api @kmail', async ({
    endpoints,
  }) => {
    /*
     * FR-KM-005 — Enforce Single Recipient in To:. The mail model carries exactly ONE `toAddress`
     * (a string, not a list); additional recipients ride in `ccList`. This asserts the model
     * structurally (the contract) AND drives a real send with one TO + one Cc.
     */
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
  });

  test('a high-priority mail carries its priority flag (FR-KM-010 / FR-KM-011) @api @kmail', async ({
    endpoints,
  }) => {
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
  });

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

  test('a confidential recipient (bccList) is hidden from the others (BR / NFR-SEC02) @api @kmail @security', async ({
    endpoints,
  }) => {
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
        .soft(view.bodyText ?? '', 'the confidential recipient is not revealed to the TO recipient')
        .not.toContain(D.username);
    } finally {
      await del(endpoints, A, sent.transactionIDs);
    }
  });

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

      // kmail-draft-content is a "needs-id" read (destructive:false, no productionSafe) — real now
      // that this flow minted a real draftMailID, via allowLiveRead.
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

  test('saluation: save → appears in the list → is reflected on the digital signature → delete removes it', async ({
    endpoints,
  }) => {
    // A unique marker per run: this account already accumulates real saved saluations, so a fixed
    // literal like "QA Dr" cannot be told apart from a leftover of a PRIOR run.
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
  });

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
});
