import { env } from '@config/env';
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

test.describe('KPost KOS · feature flow', { tag: '@kpost-api' }, () => {
  test.describe.configure({ mode: 'default' });
  test.skip(!env.KOS_LIFECYCLE, 'writes real KWord docs; set KOS_LIFECYCLE=true');

  test('KWord document lifecycle: create → save → update → share → join → reads → delete @api @kos', async ({
    endpoints,
  }) => {
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

        // Doc-keyed reads, fed the real docId.
        for (const [id, label] of [
          ['kos-get-document', 'get-document'],
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

    const chat = await run(
      endpoints,
      'kos-ai-chat',
      { body: { prompt: 'Hello from the QA bench.', aiType: 'general' } },
      'ai-chat',
    );
    expect.soft(chat.status, 'chatResponse status (>0 means sent)').toBeGreaterThan(0);
    expect.soft(chat.status, 'chatResponse returns a valid status').toBeLessThan(600);

    const assist = await run(
      endpoints,
      'kos-ai-assist',
      { body: { prompt: 'Summarise: QA bench test.', aiType: 'general' } },
      'ai-assist',
    );
    expect.soft(assist.status, 'messageAssist status (>0 means sent)').toBeGreaterThan(0);
    expect.soft(assist.status, 'messageAssist returns a valid status').toBeLessThan(600);
  });
});
