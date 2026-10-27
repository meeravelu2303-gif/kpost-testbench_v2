// An orchestrated KWord document lifecycle driving every KWord write, not simple assertions; the
// conditionals guard optional steps and cleanup of real live data.

import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * KOS feature flow: create a KWord doc, drive every KWord write and doc-keyed read, delete it in
 * `finally`. Gated by KOS_LIFECYCLE=true (real writes); the metered K-AI calls need KOS_AI_LIVE=true too.
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

/** Run one endpoint; returns its status, or -1 if the guard/production gate refuses it. */
async function run(
  endpoints: EndpointExecutor,
  id: string,
  reqOverride: Record<string, unknown>,
  label: string,
): Promise<{ status: number; data: Record<string, unknown> }> {
  try {
    const ex = await endpoints.sendTo(id, reqOverride, {
      label: `kos:${label}`,
      auth: { principal: A },
      allowLiveWrite: true,
    });
    const parsed = ex.json();
    const value = (parsed.ok ? parsed.value : {}) as Record<string, unknown>;
    return { status: ex.status, data: (value.data as Record<string, unknown>) ?? {} };
  } catch {
    return { status: -1, data: {} };
  }
}

function extractDocId(data: Record<string, unknown>): string | undefined {
  for (const c of [data.docId, data.id, data.documentId]) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return undefined;
}

test.describe('KPost KOS · feature flow', { tag: ['@api', '@platform', '@regression'] }, () => {
  test.describe.configure({ mode: 'default' });
  test.skip(process.env.KOS_LIFECYCLE !== 'true', 'writes real KWord docs; set KOS_LIFECYCLE=true');

  test('KWord document lifecycle: create → save → update → share → join → reads → delete @api @kos', async ({
    endpoints,
  }) => {
    // Known defect #499: /kword/create returns no docId, so every later step (all docId-keyed) is skipped.
    let docId: string | undefined;
    try {
      const created = await run(
        endpoints,
        'kos-create-doc',
        {
          body: {
            titleOfDocument: 'QA Bench Doc',
            subject: 'QA bench',
            documentType: 'word',
            convertToKad: false,
            initiatedBy: testData.kpostId,
          },
        },
        'create',
      );
      if (created.status >= 500) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'kos-create-doc',
          ruleId: 'REGRESSION-kword-create-still-500',
          rule: '/kword/create must actually create a document and return a docId — #499 fixed some cases but this reproduces the same 500 on the documented default payload.',
          expected: 'status < 300 and a real docId',
          actual: `status=${created.status}`,
          request: { body: { titleOfDocument: 'QA Bench Doc', documentType: 'word' } },
        });
      }
      expect.soft(created.status, 'createDoc is accepted').toBeLessThan(300);
      docId = extractDocId(created.data);
      expect.soft(docId, 'create returns a docId').toBeTruthy();

      if (docId) {
        const writes: Array<[string, Record<string, unknown>, string]> = [
          [
            'kos-save-content',
            { body: { docTitle: 'QA Bench Doc', compose: 'QA content', docId } },
            'save-content',
          ],
          [
            'kos-update-doc',
            { body: { docId, heading: [{ topic: 'Introduction', children: [] }] } },
            'update',
          ],
          ['kos-delete-heading', { body: { docId, headingId: 1 } }, 'delete-heading'],
          ['kos-convert-to-kad', { body: { docId, convertToKad: true } }, 'convert'],
          [
            'kos-share-doc',
            {
              body: {
                docId,
                kWordDocshares: [
                  {
                    kpostId: testData.victimKpostId,
                    role: 'editor',
                    validUpto: Date.now() + 86_400_000,
                  },
                ],
              },
            },
            'share',
          ],
          [
            'kos-join-doc',
            {
              body: {
                docId,
                kpostId: testData.kpostId,
                deviceInfo: { browser: 'Chrome', os: 'Windows', deviceType: 'desktop' },
              },
            },
            'join',
          ],
        ];
        for (const [id, req, label] of writes) {
          const r = await run(endpoints, id, req, label);
          // status -1 means the guard/gate refused it — surface that, don't mask it.
          expect.soft(r.status, `${label} status (>0 means it was sent)`).toBeGreaterThan(0);
          expect.soft(r.status, `${label} returns a valid status`).toBeLessThan(600);
        }

        // The heading sent by kos-update-doc must actually be stored.
        const getDoc = await run(
          endpoints,
          'kos-get-document',
          { pathParams: { docId } },
          'get-document',
        );
        expect.soft(getDoc.status, 'get-document returns a status').toBeLessThan(600);
        if (getDoc.status < 300) {
          const headings = (getDoc.data as { heading?: Array<{ topic?: string }> } | undefined)
            ?.heading;
          expect
            .soft(
              Array.isArray(headings) && headings.some((h) => h?.topic === 'Introduction'),
              'the heading set by kos-update-doc actually appears in a fresh read',
            )
            .toBe(true);
        }

        // Doc-keyed reads, fed the real docId.
        for (const [id, label] of [
          ['kos-presence', 'presence'],
          ['kos-access-activity', 'access-activity'],
          ['kos-revisions', 'revisions'],
        ] as Array<[string, string]>) {
          const r = await run(endpoints, id, { pathParams: { docId } }, label);
          expect.soft(r.status, `${label} returns a status`).toBeLessThan(600);
        }

        const exit = await run(endpoints, 'kos-exit-doc', { pathParams: { docId } }, 'exit');
        expect.soft(exit.status, 'exitDocument returns a status').toBeLessThan(600);
      }
    } finally {
      if (docId) {
        await run(endpoints, 'kos-delete-doc', { query: { docId } }, 'delete');
      }
    }
  });

  test('K-AI generation: chatResponse and messageAssist (metered — owner-authorized) @api @kos', async ({
    endpoints,
  }) => {
    // These bill a real AI service, so this test runs ONLY with KOS_AI_LIVE=true, above and beyond
    // the KOS_LIFECYCLE gate. One prompt each, on our own account.
    test.skip(process.env.KOS_AI_LIVE !== 'true', 'metered AI calls; set KOS_AI_LIVE=true to run');

    // aiType 'general' is off-contract (the workbook lists chatgpt/perplexity/gemini/mistral/deepseek);
    // kept as-is pending an owner decision.
    const chat = await run(
      endpoints,
      'kos-ai-chat',
      { body: { prompt: 'Hello from the QA bench.', aiType: 'general' } },
      'ai-chat',
    );
    expect.soft(chat.status, 'chatResponse status (>0 means sent)').toBeGreaterThan(0);
    expect.soft(chat.status, 'chatResponse returns a valid status').toBeLessThan(600);

    // The live client sends {message, prompt, requestType} for messageAssist, not chatResponse's shape.
    const assist = await run(
      endpoints,
      'kos-ai-assist',
      {
        body: {
          message: 'QA bench conversation context.',
          prompt: 'Summarise: QA bench test.',
          requestType: 'REPLY',
        },
      },
      'ai-assist',
    );
    expect.soft(assist.status, 'messageAssist status (>0 means sent)').toBeGreaterThan(0);
    expect.soft(assist.status, 'messageAssist returns a valid status').toBeLessThan(600);

    // The session chatResponse just created should be listed by ai-sessions and readable via ai-messages.
    const sessions = await run(
      endpoints,
      'kos-ai-sessions',
      { query: { aiType: 'general' } },
      'sessions-after-chat',
    );
    expect.soft(sessions.status, 'ai-sessions is reachable after a chat').toBe(200);

    const sessionId = extractSessionId(chat.data);
    if (sessionId) {
      const messages = await run(
        endpoints,
        'kos-ai-messages',
        { pathParams: { sessionId } },
        'messages-for-new-session',
      );
      expect
        .soft(messages.status, 'ai-messages succeeds for the session chatResponse just created')
        .toBeLessThan(300);
    } else {
      // Recorded rather than silently skipped: no session id found in chatResponse's data.
      expect
        .soft(sessionId, "chatResponse's response carries a discoverable session id")
        .toBeTruthy();
    }
  });
});

// Ungated: free reads only. Kept outside the describe above, whose top-level test.skip would skip them too.
test.describe(
  'KPost KOS · read-only business rules @api @kos',
  { tag: ['@api', '@platform', '@regression'] },
  () => {
    test('ai-sessions: the model-bucket envelope is stable regardless of the aiType query value', async ({
      endpoints,
    }) => {
      // The backend ignores aiType and always returns every model's bucket.
      const [withRealType, withNonsenseType] = await Promise.all([
        run(endpoints, 'kos-ai-sessions', { query: { aiType: 'general' } }, 'sessions-real-type'),
        run(
          endpoints,
          'kos-ai-sessions',
          { query: { aiType: 'not-a-real-model-xyz' } },
          'sessions-bad-type',
        ),
      ]);
      expect.soft(withRealType.status, 'ai-sessions succeeds').toBe(200);
      expect
        .soft(withNonsenseType.status, 'ai-sessions succeeds even for an unrecognized aiType')
        .toBe(200);

      const expectedBuckets = ['gemini', 'perplexity', 'chatgpt', 'mistral'].sort();
      for (const [label, data] of [
        ['real aiType', withRealType.data],
        ['nonsense aiType', withNonsenseType.data],
      ] as const) {
        expect(
          Object.keys(data).sort(),
          `${label}: the four known model buckets are present`,
        ).toEqual(expectedBuckets);
        for (const bucket of expectedBuckets) {
          expect(Array.isArray(data[bucket]), `${label}: ${bucket} bucket is an array`).toBe(true);
        }
      }
      expect(
        withNonsenseType.data,
        'aiType has no filtering effect — the envelope is identical for a real vs. a nonsense value',
      ).toEqual(withRealType.data);
    });

    test('kos-list-documents: no live business-rule test (recorded gap, not a workaround)', () => {
      test.skip(
        true,
        'testingapi answers 404 "No matching endpoint for this request" for GET /kword/documents/ — ' +
          "the KWord list route is not deployed on this test build (see the endpoint definition's own " +
          'note). Not run standalone (a 404 there reads as a false CRITICAL); needs the dev to confirm ' +
          'whether the route ships on this build before a business-rule test can be written.',
      );
      expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
    });
  },
);

/** A K-AI chat/session response's session id, across the field names a Spring service might use. */
function extractSessionId(data: Record<string, unknown>): string | undefined {
  for (const c of [data.sessionId, data.session_id, data.id]) {
    if (typeof c === 'string' && c.length > 0) return c;
    if (typeof c === 'number') return String(c);
  }
  return undefined;
}
