import { KMAIL_PRIORITY, KMAIL_TYPE } from '@api/contract/kpost-types';
import { mailShape } from '@api/definitions/kmail/send.api';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import {
  A,
  B,
  C,
  call,
  deleteEverywhere,
  firstRow,
  marker,
  sendMail,
} from '../support/kmail-rules';

/**
 * KMail draft rules, read from the KMail backend (D:\KPOST_PROJECTS\Kpost_Kmail_5.0, kmail5_qa):
 * DraftMailController + KmailDraftServiceImpl, and the web client's send-from-draft sequence
 * (KPOST_REACTJS_2023_V1 WriteMailPage.js). Each test saves its own drafts as qatest1 (A) to our
 * own accounts and deletes them afterwards, whatever happened. Gated by KMAIL_LIFECYCLE=true.
 */

interface DraftRow {
  kmailID: number;
  draftMailID?: string;
  toAddress?: string;
  kmailSubject?: string;
  saluation?: string;
  saluationName?: string;
  priority?: number;
  cc?: string;
  kmailSendDate?: unknown;
}

async function saveDraft(
  endpoints: EndpointExecutor,
  overrides: Record<string, unknown>,
  label: string,
): Promise<{ status: number; kmailID?: number; body: Record<string, unknown> }> {
  const body = mailShape({ toAddress: B.username, kmailType: KMAIL_TYPE.draft, ...overrides });
  const reply = await call(endpoints, 'kmail-draft-save', A, body, `draft-rules:${label}`);
  const id = firstRow(reply).kmailID;
  return { status: reply.status, kmailID: typeof id === 'number' && id > 0 ? id : undefined, body };
}

/** A's drafts. getAllDraftMails answers 500 "No Content" for an empty list (DraftMailController.java:177-182). */
async function drafts(endpoints: EndpointExecutor): Promise<DraftRow[]> {
  const r = await call(endpoints, 'kmail-all-drafts', A, undefined, 'draft-rules:list');
  return Array.isArray(r.json.data) ? (r.json.data as DraftRow[]) : [];
}

/** Deletes a draft by kmailID alone (the lookup path, KmailDraftServiceImpl.java:621-631). */
async function deleteDraft(endpoints: EndpointExecutor, kmailID: number, label = 'cleanup') {
  return call(
    endpoints,
    'kmail-draft-delete',
    A,
    { kmailID, draftMailID: '' },
    `draft-rules:${label}`,
  );
}

async function cleanup(endpoints: EndpointExecutor, ...ids: Array<number | undefined>) {
  for (const id of ids) {
    if (id) await deleteDraft(endpoints, id).catch(() => undefined);
  }
}

test.describe('KMail draft · state rules', { tag: ['@api', '@kmail', '@regression'] }, () => {
  test.describe.configure({ mode: 'default', timeout: 120_000 });
  test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
  test.skip(process.env.KMAIL_LIFECYCLE !== 'true', 'writes real drafts; set KMAIL_LIFECYCLE=true');
  test.skip(
    !testData.kpostId || !testData.victimKpostId || !testData.personal3KpostId,
    'needs three QA accounts',
  );

  test(
    'a saved draft reads back exactly as saved',
    { annotation: [{ type: 'requirement-partial', description: 'FR-M02' }] },
    async ({ endpoints }) => {
      // createDraftObj copies To, Cc, subject, salutation, name and priority into the row
      // (KmailDraftServiceImpl.java:188-210); the body lives in the mailbox Drafts folder and is read
      // by draftMailContent (ReadKmailServiceImpl.readDraftMailContent).
      const subject = marker('draft-readback');
      const content = `QA bench draft body ${Date.now()} — safe to ignore.`;
      const saved = await saveDraft(
        endpoints,
        {
          kmailSubject: subject,
          kmailContent: content,
          ccList: [C.username],
          saluation: 'Dear',
          saluationName: 'QA Reader',
          priority: KMAIL_PRIORITY.high,
        },
        'save',
      );
      try {
        expect(saved.status, 'the draft is saved').toBe(200);
        expect(saved.kmailID, 'a draft kmailID is issued').toBeDefined();
        const row = (await drafts(endpoints)).find((d) => d.kmailID === saved.kmailID);
        expect(row, 'the draft is listed in getAllDraftMails').toBeTruthy();
        expect.soft(row?.kmailSubject, 'subject').toBe(subject);
        expect.soft(row?.toAddress?.toLowerCase(), 'To').toBe(B.username.toLowerCase());
        expect.soft(row?.cc?.toLowerCase() ?? '', 'Cc').toContain(C.username.toLowerCase());
        expect.soft(row?.saluation, 'salutation').toBe('Dear');
        expect.soft(row?.saluationName, 'salutation name').toBe('QA Reader');
        expect.soft(row?.priority, 'priority').toBe(KMAIL_PRIORITY.high);
        const body = await call(
          endpoints,
          'kmail-draft-content',
          A,
          { draftKmailID: saved.kmailID, kmailSendDate: Date.now(), kmailSubject: subject },
          'draft-rules:content',
        );
        expect.soft(body.status, 'the draft body can be opened').toBe(200);
        expect.soft(body.text, 'the draft body is unchanged').toContain(content);
      } finally {
        await cleanup(endpoints, saved.kmailID);
      }
    },
  );

  test(
    'saving a draft again with its kmailID updates it in place; no second draft appears',
    { annotation: [{ type: 'requirement-partial', description: 'FR-M02' }] },
    async ({ endpoints }) => {
      // KmailDraftServiceImpl.java:104-118: an existing kmailID drops the old mailbox copy and
      // "carries forward the kmailID so JPA does an UPDATE, not an INSERT".
      const first = marker('draft-v1');
      const second = marker('draft-v2');
      const saved = await saveDraft(endpoints, { kmailSubject: first }, 'save-v1');
      let resaved: Awaited<ReturnType<typeof saveDraft>> | undefined;
      try {
        expect(saved.kmailID, 'the draft is saved').toBeDefined();
        resaved = await saveDraft(
          endpoints,
          { kmailID: saved.kmailID, kmailSubject: second },
          'save-v2',
        );
        expect.soft(resaved.status, 'the re-save is accepted').toBe(200);
        const list = await drafts(endpoints);
        const withNew = list.filter((d) => d.kmailSubject === second);
        const withOld = list.filter((d) => d.kmailSubject === first);
        if (withNew.length !== 1 || withOld.length !== 0 || resaved.kmailID !== saved.kmailID) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'kmail-draft-save',
            ruleId: 'KMAIL-draft-update-in-place',
            rule: 'draftMail with the kmailID of an existing draft must update that draft, not create another (KmailDraftServiceImpl.saveAsDraftMail).',
            expected: `one draft, kmailID ${saved.kmailID}, subject "${second}"`,
            actual: `re-save answered ${resaved.status} with kmailID ${resaved.kmailID ?? 'none'}; drafts with the new subject: ${withNew.length}, with the old: ${withOld.length}`,
            request: { body: resaved.body },
          });
        }
        expect.soft(resaved.kmailID, 'the draft keeps its kmailID').toBe(saved.kmailID);
        expect.soft(withNew, 'exactly one draft has the new subject').toHaveLength(1);
        expect.soft(withOld, 'no draft keeps the old subject').toHaveLength(0);
      } finally {
        await cleanup(endpoints, saved.kmailID, resaved?.kmailID);
      }
    },
  );

  test(
    'deleting a draft that does not exist, or one already deleted, is refused with 400',
    { annotation: [{ type: 'requirement-partial', description: 'FR-M02' }] },
    async ({ endpoints }) => {
      // KmailDraftServiceImpl.java:621-629: no draft for the kmailID → 400 "No draft found".
      const saved = await saveDraft(endpoints, { kmailSubject: marker('draft-del') }, 'save');
      let gone = false;
      try {
        expect(saved.kmailID, 'the draft is saved').toBeDefined();
        const firstDelete = await deleteDraft(endpoints, saved.kmailID!, 'delete-1');
        gone = firstDelete.status === 200;
        expect.soft(firstDelete.status, 'the first delete succeeds').toBe(200);
        const again = await deleteDraft(endpoints, saved.kmailID!, 'delete-2');
        expect.soft(again.status, 'deleting it a second time is a 400').toBe(400);
        // Far above any auto-increment id: names no real draft.
        const unknown = await deleteDraft(endpoints, 9_007_199_254_740_000, 'delete-unknown');
        expect.soft(unknown.status, 'an unknown draft kmailID is a 400, not a 500').toBe(400);
      } finally {
        if (!gone) await cleanup(endpoints, saved.kmailID);
      }
    },
  );

  test(
    'a draft that is sent leaves Drafts (the web client’s send-then-delete sequence)',
    {
      annotation: [
        { type: 'requirement-partial', description: 'FR-M02' },
        { type: 'requirement-partial', description: 'FR-KM-018' },
      ],
    },
    async ({ endpoints }) => {
      // WriteMailPage.js:1774-1785: on a SUCCESS postMail the client calls deleteDraftMail with the
      // draft's {kmailID, draftMailID, kmailSendDate}; postMail itself never touches the draft row.
      const subject = marker('draft-send');
      const saved = await saveDraft(endpoints, { kmailSubject: subject }, 'save');
      let sentID: number | undefined;
      try {
        expect(saved.kmailID, 'the draft is saved').toBeDefined();
        const row = (await drafts(endpoints)).find((d) => d.kmailID === saved.kmailID);
        expect(row, 'the draft is listed').toBeTruthy();
        const sent = await sendMail(endpoints, { kmailSubject: subject }, 'draft-rules:send');
        sentID = sent.kmailID;
        expect(sent.reply.status, 'the drafted mail is sent').toBe(200);
        const del = await call(
          endpoints,
          'kmail-draft-delete',
          A,
          {
            kmailID: saved.kmailID,
            draftMailID: row?.draftMailID ?? '',
            kmailSendDate: row?.kmailSendDate,
          },
          'draft-rules:delete-after-send',
        );
        expect.soft(del.status, 'the draft is deleted after the send').toBe(200);
        const left = (await drafts(endpoints)).filter(
          (d) => d.kmailID === saved.kmailID || d.kmailSubject === subject,
        );
        expect.soft(left, 'the sent draft no longer appears in Drafts').toEqual([]);
      } finally {
        await cleanup(endpoints, saved.kmailID);
        await deleteEverywhere(endpoints, sentID);
      }
    },
  );
});
