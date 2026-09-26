import { expect, test } from '@fixtures';

/**
 * Katchup **attachment upload** — recorded gap, not a workaround.
 *
 * `katchup-send-multipart` (`sendKatchupMsgMultiPart`) previously had a live business-rule test here:
 * it accepted a file part (200, real msgID — unblocked by the 2026-09-25 `groupFlag` fix) but the
 * created message's `attachmentUuid` came back `null`, both immediately and on readback. Filed as
 * **#614** [KP-90586F], HIGH, KPost API.
 *
 * **Owner-confirmed 2026-09-26: that route is legacy and not used by the current client.** The
 * product's real attachment flow generates a presigned S3 URL (`aws-katchup-presigned`), uploads the
 * file directly to S3 with it, then sends an ordinary `katchup-send-message` whose `uuid` array names
 * the uploaded attachment — see `presigned-attachment-workflow.spec.ts`. #614 is closed WONTFIX: the
 * behaviour is real, but the route it was found on is dead code from the product's own perspective,
 * so it is not chased further and no longer asserted here.
 */
test.describe('KPost Katchup · attachment upload (legacy multipart route)', () => {
  test('sendKatchupMsgMultiPart: no live business-rule test (legacy route, superseded by presigned S3 upload)', () => {
    test.skip(
      true,
      'katchup-send-multipart is the OLD direct-upload path — owner-confirmed 2026-09-26 that the ' +
        'current client uses the presigned-URL flow instead (aws-katchup-presigned + a direct S3 PUT ' +
        '+ katchup-send-message\'s own uuid field). The route stays registered (generic validator ' +
        'sweep still runs against it) but its attachment-storage behaviour is no longer product-' +
        'relevant, so it is not asserted on live. The prior finding is closed as #614 WONTFIX, not ' +
        'chased further. See presigned-attachment-workflow.spec.ts for the current, real upload path.',
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });
});
