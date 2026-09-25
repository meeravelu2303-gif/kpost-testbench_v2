import { expect, test } from '@fixtures';

/**
 * Katchup **needs-id reads — recorded gaps, not workarounds**.
 *
 * Most of this file's original 12 gaps were closed 2026-09-25 once `katchup-send-message`'s
 * `groupFlag` bug was fixed (see `send-regression.spec.ts`) — that single fix unblocked sending a
 * real message at all, which turned out to be everything the shared/reference reads needed (see
 * `shared-reference-workflow.spec.ts`). Two categories remain genuinely blocked:
 *
 *   - **Route not deployed on this test build** (`katchup-messages-subject`): a 404 there reads as a
 *     false CRITICAL, the same pattern as `kos-list-documents`/`kmail-postbox-contacts` this session.
 *   - **The attachment upload path exists but doesn't actually attach anything**
 *     (`katchup-download`, `katchup-download-attachment`, `katchup-download-from-s3`,
 *     `katchup-download-thumbnail`, `katchup-media-streaming`, `katchup-generate-thumbnail`):
 *     `katchup-send-multipart` — previously blocked by the SAME `groupFlag` bug as `sendMessage`
 *     (its `text` field embeds `sendShape()`) — now answers 200 with a real msgID once that was
 *     fixed. But live-verified 2026-09-25: the message it creates has `attachmentUuid: null`, on the
 *     immediate response AND on a fresh readback — the file part is accepted (no longer a 400) but
 *     never actually attached. So there is still no way to mint a real attachment uuid to test the
 *     six download/streaming reads with. Filed as **#614** [KP-90586F], HIGH, KPost API; see
 *     `attachment-workflow.spec.ts`.
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

  test('katchup-download / katchup-download-attachment / katchup-download-from-s3 / katchup-download-thumbnail / katchup-media-streaming / katchup-generate-thumbnail: no live test (send-multipart accepts a file but never attaches it)', () => {
    test.skip(
      true,
      'katchup-send-multipart now succeeds (200, real msgID — the groupFlag fix unblocked it too, ' +
        'since its text field embeds sendShape()), but live-verified 2026-09-25: the created message ' +
        'has attachmentUuid: null both immediately and on a fresh readback — the multipart file part ' +
        'is accepted without a 400 but never actually stored as an attachment. See ' +
        'attachment-workflow.spec.ts for the confirmed finding. Still no real attachment uuid exists ' +
        'to test these six reads with; not worked around with a fabricated one.',
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });
});
