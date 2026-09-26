// An orchestrated KWord document lifecycle driving every KWord write, not simple assertions; the
// conditionals guard optional steps and cleanup of real live data.
/* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect */
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * KOS **feature flow** — create a KWord document and drive every KWord WRITE and doc-keyed read end
 * to end on a real host, self-cleaning (delete in `finally`). Gated `KOS_LIFECYCLE=true`, each write
 * `allowLiveWrite`, all on our own account / second account. The two K-AI generation endpoints
 * (`chatResponse`, `messageAssist`) are `external` (metered) and are NOT driven here.
 *
 * `kos-ai-sessions`, `kos-ai-messages` and `kos-list-documents` are covered at the bottom of this
 * file: the sessions list is a free (non-metered) read exercised directly; the messages read needs a
 * real sessionId that only a metered chat call can create, so it is chained into the KOS_AI_LIVE test
 * below rather than exercised standalone; `kos-list-documents` 404s on this test build (route not
 * deployed) and is recorded as a gap.
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

test.describe('KPost KOS · feature flow', () => {
  test.describe.configure({ mode: 'default' });
  test.skip(process.env.KOS_LIFECYCLE !== 'true', 'writes real KWord docs; set KOS_LIFECYCLE=true');

  test('KWord document lifecycle: create → save → update → share → join → reads → delete @api @kos', async ({
    endpoints,
  }) => {
    /*
     * Bugzilla #499 was closed RESOLVED/FIXED on 2026-09-22 — but live-verified again 2026-09-26
     * with KOS_LIFECYCLE=true and it still reproduces exactly as originally reported: /kword/create
     * still fails to return a docId, so the whole downstream lifecycle (save/update/share/join/
     * reads/delete) still cannot run. #499 reopened with this evidence. This test previously trusted
     * the ticket's FIXED status and switched from a pinned `test.fail()` to a plain soft assertion
     * with no explicit filing — that assertion alone did not get this reliably tracked on every run
     * (the auto-pipeline did not pick it up on the re-verification run), so it is filed explicitly
     * below now, matching the pattern used for the other "reported fixed but wasn't" tickets found
     * this session (#501, #507). The first run after this fix filed a new ticket (#624) instead of
     * commenting on the reopened #499 — closed as a duplicate of #499, which is the ticket of record
     * going forward.
     *
     * Pinning the WHOLE lifecycle is right in this one case, where it would be wrong elsewhere:
     * every later step (save, update, share, join, delete) takes a docId that only create can
     * issue, so there is no downstream assertion for the inversion to mask. The moment create
     * works, this turns RED (in the sense of "0 findings, nothing filed") and the rest of the flow
     * starts being exercised for real.
     */
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

        /*
         * Field-level check for `kos-update-doc`, added 2026-09-26: previously nothing here (or the
         * doc-keyed reads below) ever confirmed the "Introduction" heading sent above was actually
         * stored — every check in this file was status-only. Cannot be live-verified yet: this whole
         * test never reaches this point while #499 (kword/create) is still broken (docId is always
         * undefined), so this is the correct assertion to have ready, not a live-confirmed one.
         */
        const getDoc = await run(endpoints, 'kos-get-document', { pathParams: { docId } }, 'get-document');
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

    /*
     * aiType is sent as 'general' here and in the endpoint definitions (kos/write.api.ts,
     * kos/read.api.ts), but the workbook contract documents only chatgpt/perplexity/gemini/mistral/
     * deepseek as valid values (messageAssist: aiType is optional and defaults to deepseek).
     * 'general' is off-contract. What the backend actually does with an unrecognized value — silently
     * defaults, errors, or something else — is Unknown/Requires Clarification: verifying it means a
     * real metered call, which is exactly what this gate exists to prevent doing casually. Left as-is
     * pending an owner decision on whether to correct it to a real model name.
     */
    const chat = await run(
      endpoints,
      'kos-ai-chat',
      { body: { prompt: 'Hello from the QA bench.', aiType: 'general' } },
      'ai-chat',
    );
    expect.soft(chat.status, 'chatResponse status (>0 means sent)').toBeGreaterThan(0);
    expect.soft(chat.status, 'chatResponse returns a valid status').toBeLessThan(600);

    // The live client (AI_Common.js) sends {message, prompt, requestType} for messageAssist, NOT
    // {prompt, aiType} (that is chatResponse's shape) — see the endpoint definition's own note.
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

    // Cross-endpoint dependency (Phase 4): a session chatResponse just created should be
    // discoverable via ai-sessions, and its content readable via ai-messages — neither of which can
    // be verified without a real sessionId, which only this metered call can produce.
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
      // Recorded rather than silently skipped: chatResponse's response shape hasn't been observed
      // (no session id in its data under any of the field names guessed below), so ai-messages
      // still has no live-verified business-rule test.
      expect
        .soft(sessionId, "chatResponse's response carries a discoverable session id")
        .toBeTruthy();
    }
  });
});

/*
 * A separate, UNGATED describe: these do not need KOS_LIFECYCLE. `ai-sessions` is a free
 * (non-metered) read, safe to run on every default run; the list-documents test is a recorded gap
 * placeholder, not a write. Keeping them out of the KOS_LIFECYCLE-gated describe above matters
 * because `test.skip(condition, reason)` at a describe's top level applies to every test registered
 * in that describe, not just the ones after it — nesting them there would have silently skipped both
 * on a default run.
 */
test.describe('KPost KOS · read-only business rules @api @kos', () => {
  test('ai-sessions: the model-bucket envelope is stable regardless of the aiType query value', async ({
    endpoints,
  }) => {
    // Live-verified 2026-09-24: a nonsense aiType returns the SAME four-model envelope as a real
    // one — the backend does not filter by aiType at all, it always returns every model's bucket.
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
});

/** A K-AI chat/session response's session id, across the field names a Spring service might use. */
function extractSessionId(data: Record<string, unknown>): string | undefined {
  for (const c of [data.sessionId, data.session_id, data.id]) {
    if (typeof c === 'string' && c.length > 0) return c;
    if (typeof c === 'number') return String(c);
  }
  return undefined;
}
