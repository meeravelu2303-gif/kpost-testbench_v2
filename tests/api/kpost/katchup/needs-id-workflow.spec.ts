import { expect, test } from '@fixtures';

/**
 * Katchup **needs-id reads — recorded gaps, not workarounds**.
 *
 * Most of this file's original 12 gaps were closed 2026-09-25 once `katchup-send-message`'s
 * `groupFlag` bug was fixed (see `send-regression.spec.ts`) — that single fix unblocked sending a
 * real message at all, which turned out to be everything the shared/reference reads needed (see
 * `shared-reference-workflow.spec.ts`). The six attachment download/streaming reads
 * (`katchup-download`, `katchup-download-attachment`, `katchup-download-from-s3`,
 * `katchup-download-thumbnail`, `katchup-media-streaming`, `katchup-generate-thumbnail`) were closed
 * 2026-09-26: the legacy `katchup-send-multipart` upload path never actually attached anything
 * (#614), but the owner confirmed the CURRENT production flow is a presigned S3 URL upload instead —
 * see `presigned-attachment-workflow.spec.ts`, which mints a real attachment uuid and drives all six
 * reads with it (two real defects found and filed: #617, #618).
 *
 * One category remains genuinely blocked:
 *
 *   - **Route not deployed on this test build** (`katchup-messages-subject`): a 404 there reads as a
 *     false CRITICAL, the same pattern as `kos-list-documents`/`kmail-postbox-contacts` this session.
 */

test.describe('KPost Katchup · needs-id reads (recorded gaps)', () => {
  test('katchup-messages-subject: no live test (404 — route not deployed on this test build)', () => {
    test.skip(
      true,
      'testingapi answers 404 "No matching endpoint for this request" for GET ' +
        "getKatchupMessagesSubject (see the endpoint definition's own note). Not run standalone (a " +
        '404 there reads as a false CRITICAL); needs the dev to confirm whether the route is deployed ' +
        'on this build. The Subject differentiator (BR-K01) is otherwise proven by the feature flow.',
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });
});
