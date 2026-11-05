import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { A, call, marker } from '../support/kmail-rules';

/**
 * KMail settings rules (salutations, instant replies, mail-count days limit), read from the KMail
 * backend (D:\KPOST_PROJECTS\Kpost_Kmail_5.0, kmail5_qa): KmailSettingController, CommonDaoImpl and
 * KmailSettingServiceImpl. Every test acts on qatest1's own settings, removes what it added and
 * restores what it changed, in finally. (KMail has no vacation-response setting; the instant reply
 * is the nearest one.) Gated by KMAIL_LIFECYCLE=true like the settings flows.
 */

interface Saluation {
  saluationID: string;
  saluation: string;
}
interface InstantReply {
  id: string;
  instantReply: string;
}

async function saluations(endpoints: EndpointExecutor): Promise<Saluation[]> {
  const r = await call(endpoints, 'kmail-saluations', A, undefined, 'settings-rules:sal-list');
  return Array.isArray(r.json.data) ? (r.json.data as Saluation[]) : [];
}

async function instantReplies(endpoints: EndpointExecutor): Promise<InstantReply[]> {
  const r = await call(endpoints, 'kmail-digital-signature', A, undefined, 'settings-rules:sig');
  const raw = (r.json.data as { customizedInstantReply?: string } | undefined)
    ?.customizedInstantReply;
  try {
    const parsed = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as InstantReply[]) : [];
  } catch {
    return [];
  }
}

async function countDaysLimit(endpoints: EndpointExecutor): Promise<number | undefined> {
  const r = await call(endpoints, 'kmail-count-days-limit', A, undefined, 'settings-rules:count');
  const v = (r.json.data as { countDaysLimit?: unknown } | undefined)?.countDaysLimit;
  return typeof v === 'number' ? v : undefined;
}

const deleteSaluation = (endpoints: EndpointExecutor, saluationID: string, label = 'sal-cleanup') =>
  call(endpoints, 'kmail-delete-saluation', A, { saluationID }, `settings-rules:${label}`).catch(
    () => undefined,
  );

const deleteReply = (endpoints: EndpointExecutor, id: string, label = 'reply-cleanup') =>
  call(endpoints, 'kmail-delete-instant-reply', A, { id }, `settings-rules:${label}`).catch(
    () => undefined,
  );

test.describe('KMail settings · input rules', { tag: ['@api', '@kmail', '@regression'] }, () => {
  test.describe.configure({ mode: 'default', timeout: 120_000 });
  test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
  test.skip(
    process.env.KMAIL_LIFECYCLE !== 'true',
    'writes real KMail settings; set KMAIL_LIFECYCLE=true',
  );
  test.skip(!testData.kpostId, 'needs the primary QA account');

  test(
    'a blank salutation is refused and nothing is saved',
    { annotation: [{ type: 'requirement-partial', description: 'FR-KM-007' }] },
    async ({ endpoints }) => {
      // CommonDaoImpl.java:526-529 returns FAILURE for a null/blank salutation → 400 "Salutation
      // name is required" (KmailSettingController.java:166-172). A nameless salutation crashes the
      // web composer (#13211/#13212).
      const before = new Set((await saluations(endpoints)).map((s) => s.saluationID));
      const r = await call(
        endpoints,
        'kmail-save-saluation',
        A,
        { saluationID: '', saluation: '   ' },
        'settings-rules:sal-blank',
      );
      const added = (await saluations(endpoints)).filter((s) => !before.has(s.saluationID));
      try {
        expect.soft(r.status, 'a whitespace-only salutation is refused with 400').toBe(400);
        expect.soft(added, 'no salutation is added').toEqual([]);
      } finally {
        for (const s of added) await deleteSaluation(endpoints, s.saluationID);
      }
    },
  );

  test(
    'saving a salutation with its id updates it in place; no second entry appears',
    { annotation: [{ type: 'requirement-partial', description: 'FR-KM-007' }] },
    async ({ endpoints }) => {
      // CommonDaoImpl.java:549-556: a matching saluationID replaces the text instead of appending.
      const first = marker('Sal v1');
      const second = marker('Sal v2');
      const before = new Set((await saluations(endpoints)).map((s) => s.saluationID));
      let mine: Saluation[] = [];
      try {
        const saved = await call(
          endpoints,
          'kmail-save-saluation',
          A,
          { saluationID: '', saluation: first },
          'settings-rules:sal-save',
        );
        expect(saved.status, 'the salutation is saved').toBe(200);
        const entry = (await saluations(endpoints)).find((s) => s.saluation === first);
        expect(entry, 'the salutation is listed with an id').toBeTruthy();
        const updated = await call(
          endpoints,
          'kmail-save-saluation',
          A,
          { saluationID: entry!.saluationID, saluation: second },
          'settings-rules:sal-update',
        );
        expect.soft(updated.status, 'the update is accepted').toBe(200);
        mine = (await saluations(endpoints)).filter((s) => !before.has(s.saluationID));
        expect.soft(mine, 'still exactly one new salutation').toHaveLength(1);
        expect.soft(mine[0]?.saluationID, 'with the same id').toBe(entry!.saluationID);
        expect.soft(mine[0]?.saluation, 'and the new text').toBe(second);
      } finally {
        if (!mine.length) {
          mine = (await saluations(endpoints)).filter((s) => !before.has(s.saluationID));
        }
        for (const s of mine) await deleteSaluation(endpoints, s.saluationID);
      }
    },
  );

  test(
    'deleting a salutation or instant reply id that does not exist is refused with 400',
    { annotation: [{ type: 'requirement-partial', description: 'FR-KM-007' }] },
    async ({ endpoints }) => {
      // Not found → " Invalid ID" → 400 (CommonDaoImpl.java:600-602 with
      // KmailSettingController.java:207-213; CommonDaoImpl.java:404-406 with :132-138).
      const ghost = `qa-bench-missing-${Date.now()}`;
      const sal = await deleteSaluation(endpoints, ghost, 'sal-delete-unknown');
      const reply = await deleteReply(endpoints, ghost, 'reply-delete-unknown');
      expect.soft(sal?.status, 'an unknown saluationID is a 400').toBe(400);
      expect.soft(reply?.status, 'an unknown instant-reply id is a 400').toBe(400);
    },
  );

  test(
    'a blank instant reply is refused, as a blank salutation is',
    { annotation: [{ type: 'requirement-partial', description: 'FR-KM-007' }] },
    async ({ endpoints }) => {
      // CommonDaoImpl.saveOrUpdateCustomizedInstantReply (:339-386) stores any text, blank included;
      // the sibling salutation save refuses blanks (:526-529). An empty auto-reply is no reply.
      const before = new Set((await instantReplies(endpoints)).map((r) => r.id));
      const body = { id: '', instantReply: '   ' };
      const r = await call(
        endpoints,
        'kmail-set-instant-reply',
        A,
        body,
        'settings-rules:reply-blank',
      );
      const added = (await instantReplies(endpoints)).filter((x) => !before.has(x.id));
      try {
        if (r.status < 400 || added.length) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'kmail-set-instant-reply',
            ruleId: 'KMAIL-instant-reply-not-blank',
            rule: 'saveOrUpdateCustomizedInstantReply must refuse a blank reply, as saveOrUpdateCustomizedSaluations refuses a blank salutation (CommonDaoImpl.java:526-529); it stores any value.',
            expected: '400, nothing stored',
            actual: `saveOrUpdateCustomizedInstantReply answered ${r.status}; ${added.length} new blank repl${added.length === 1 ? 'y' : 'ies'} stored`,
            request: { body },
          });
        }
        expect.soft(r.status, 'a whitespace-only instant reply is refused').toBe(400);
        expect.soft(added, 'no instant reply is stored').toEqual([]);
      } finally {
        for (const x of added) await deleteReply(endpoints, x.id);
      }
    },
  );

  test(
    'a mail-count days limit outside the offered options is refused and the stored value stays',
    { annotation: [{ type: 'non-functional', description: 'KMail settings input range' }] },
    async ({ endpoints }) => {
      // getMailCountDaysLimit offers 45, 60, 90, 120 (KmailSettingServiceImpl.java:695-698), but
      // updateMailCountDaysLimit stores any number (:683-692; the controller checks only that it is
      // a Number, KmailSettingController.java:650-655).
      const original = await countDaysLimit(endpoints);
      expect(original, 'the current limit reads back').toBeDefined();
      try {
        for (const value of [0, -30, 7, 100_000]) {
          const body = { countDaysLimit: value };
          const r = await call(
            endpoints,
            'kmail-count-days-limit-update',
            A,
            body,
            `settings-rules:count-${value}`,
          );
          const stored = await countDaysLimit(endpoints);
          if (r.status < 400 || stored === value) {
            endpoints.recordBusinessRuleViolation({
              endpointId: 'kmail-count-days-limit-update',
              ruleId: 'KMAIL-count-days-limit-options',
              rule: 'updateMailCountDaysLimit must accept only the offered options 45/60/90/120 (getMailCountDaysLimit); it stores any number.',
              expected: `a 4xx for ${value}, the limit stays ${original}`,
              actual: `updateMailCountDaysLimit answered ${r.status}; the stored limit is now ${String(stored)}`,
              request: { body },
            });
          }
          expect.soft(r.status, `countDaysLimit ${value} is refused`).toBe(400);
          expect.soft(stored, `the limit is unchanged after ${value}`).toBe(original);
        }
      } finally {
        if (original !== undefined) {
          await call(
            endpoints,
            'kmail-count-days-limit-update',
            A,
            { countDaysLimit: original },
            'settings-rules:count-restore',
          ).catch(() => undefined);
          expect
            .soft(await countDaysLimit(endpoints), 'the original limit is restored')
            .toBe(original);
        }
      }
    },
  );
});
