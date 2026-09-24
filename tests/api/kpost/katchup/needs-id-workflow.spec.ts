import { expect, test } from '@fixtures';

/**
 * Katchup **needs-id reads — recorded gaps, not workarounds**.
 *
 * All 12 share one of three blockers:
 *
 *   - **Route not deployed on this test build** (`katchup-messages-subject`): a 404 there reads as a
 *     false CRITICAL, the same pattern as `kos-list-documents`/`kmail-postbox-contacts` this session.
 *   - **No id-minting path found within the registered API surface** (`katchup-shared-message-*`,
 *     `katchup-bulk-message-info`, `katchup-reference-details`, `katchup-messages-by-reference`):
 *     each needs a real `sharedMessageId`/reference-message id, but no registered endpoint creates
 *     one — "sharing" and "referencing" appear to be side effects of actions not fully mapped here.
 *   - **Needs a real attachment upload lifecycle that doesn't exist yet**
 *     (`katchup-download*`, `katchup-media-streaming`, `katchup-generate-thumbnail`): same class of
 *     gap as KMail's `kmail-download-thumbnail`/`kmail-media-streaming`/`kmail-download-attachment`
 *     this session — minting a presigned URL is not the same as a real file actually landing at a
 *     real uuid, and no send/multipart flow in this suite currently produces one reliably (see below).
 *
 * **Also live-verified 2026-09-24, blocking further work on this module right now**: the most basic
 * `katchup-send-message` call — the exact default payload every other rich Katchup test already
 * depends on — now answers 400 `{"data":[],"status":"FAILURE"}` with no diagnosable message, from
 * two different accounts, both with and without overrides. This is not something introduced by this
 * session's changes (confirmed against the endpoint's pure, unmodified default shape). It blocks
 * chaining ANY of the reference/shared/attachment reads above via a fresh send, and reopened an
 * existing tracked defect via this session's own `feature.spec.ts` runs. Recorded here rather than
 * worked around with a fabricated id.
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

  test('katchup-shared-message-info / katchup-shared-message-details / katchup-bulk-message-info: no live test (no id-minting endpoint found)', () => {
    test.skip(
      true,
      'each needs a real sharedMessageId, but no registered Katchup endpoint in this suite creates ' +
        'one — there is no "share a message" write to chain from, unlike forward (which mints a real ' +
        'msgID via katchup-forward-message-new, now wired to katchup-forward-backtrack). Recorded as ' +
        'Unknown/Requires Clarification: needs the dev to confirm what user action actually produces ' +
        'a sharedMessageId (bulk send? group broadcast?) before a real test can be written.',
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });

  test('katchup-reference-details / katchup-messages-by-reference: no live test (no id-minting path found)', () => {
    test.skip(
      true,
      'both need real reference-message ids. The forward flow carries a referenceMessageIDList, but ' +
        'the direct katchup-forward-message endpoint 400s on a minimal payload (it validates a full ' +
        'referenceMessage object, not just an id — see the "forward carries a message" test\'s own ' +
        "note), and this session's send outage (see the module docstring above) blocked chasing this " +
        'further today.',
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });

  test('katchup-download / katchup-download-attachment / katchup-download-from-s3 / katchup-download-thumbnail / katchup-media-streaming / katchup-generate-thumbnail: no live test (needs an attachment upload lifecycle not yet built)', () => {
    test.skip(
      true,
      'all six need a real attachment uuid from a message that actually has a file attached. ' +
        'katchup-send-multipart (the documented way to attach a file) answered a business-level 400 ' +
        '(`{"data":[],"statusCode":400}`, no message) using its own sendShape()-based default text ' +
        "part, even before this session's broader send outage — the multipart contract for this " +
        "endpoint has not been successfully reverse-engineered. Same class of gap as KMail's " +
        'download/media-streaming endpoints this session; recorded for a future dedicated attachment-' +
        'lifecycle investigation, not worked around with a fabricated uuid.',
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });
});
