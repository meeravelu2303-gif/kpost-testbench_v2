import { defineValidator } from '@engine/validator';
import { outcome } from '@engine/validation-result';
import { hasNoContent, mediaType } from '../support';

/**
 * A type-appropriate check for endpoints that return an image or other binary body.
 *
 * ## Why this exists
 *
 * The JSON and field validators (`response.schema`, `common.email`, …) all skip a binary body —
 * correctly, since a PNG is not JSON. But that left the image endpoints with almost no positive
 * assertion: dozens of checks that skipped with "response body is empty" or "not valid JSON", and
 * nothing that actually looked at the bytes. That is how a real defect hid there — downloadCoverImage
 * serving PNG bytes under `Content-Type: image/jpeg` (Bugzilla #504), which the existing
 * `response.content-type` check misses because the endpoint is configured `image/*` and the wildcard
 * accepts any subtype.
 *
 * This validator does what those skips could not: it reads the body's MAGIC NUMBER and compares the
 * real format to the Content-Type the server claimed. It turns a skip into either a genuine PASS
 * (the account simply has no image) or a genuine, actionable FAIL (the header lies about the body).
 *
 * ## What each outcome means
 *
 *  - **No content (204 / 404 / empty)** → PASS. An account with no profile image, cover or signature
 *    is a normal state, and answering 204/404 for it is correct. This is the common case behind the
 *    "response body is empty" skips, and it is a pass, not a defect.
 *  - **Body present, magic number matches the Content-Type** → PASS. The image is real and correctly
 *    labelled.
 *  - **Body present, Content-Type disagrees with the magic number** → FAIL. The server mislabels the
 *    format; a strict client decoding by Content-Type mishandles it.
 *  - **Body present, claims `image/*` but the bytes are no known image** → FAIL. It is not the image
 *    it says it is.
 */
export const binaryContentValidator = defineValidator({
  name: 'response.binary-content',
  category: 'RESPONSE',
  severity: 'MEDIUM',
  description: "A binary/image response's Content-Type matches the bytes it actually returned",
  toggle: 'contentType',
  appliesTo: ({ endpoint }) => {
    const tags = endpoint.tags ?? [];
    return tags.includes('binary') || tags.includes('image') ? true : 'not a binary/image endpoint';
  },
  check: ({ primary }) => {
    /*
     * No body is the normal "this account has no image" case — a pass, not a skip and not a defect.
     * (A missing image that SHOULD exist is a different endpoint's concern; here, 204/404 is the
     * documented way to say "nothing to serve".)
     */
    if (hasNoContent(primary) || !primary.hasBody) {
      return outcome.passed(`no image stored (HTTP ${primary.status}) — nothing to mislabel`);
    }

    const declared = mediaType(primary.contentType);
    const actual = primary.magicType; // from the body's magic number, header-independent

    const extras = {
      expected: `Content-Type consistent with the body`,
      actual: `Content-Type: ${primary.contentType ?? '(missing)'}, body magic: ${actual ?? 'unrecognised'}`,
    };

    if (actual) {
      // The body is a recognised format. The header must agree with it.
      if (!declared) {
        return outcome.failed(`binary body (${actual}) served with no Content-Type header`, extras);
      }
      if (declared !== actual) {
        return outcome.failed(
          `Content-Type says ${declared} but the body is actually ${actual} — a mislabelled image`,
          extras,
        );
      }
      return outcome.passed(`body is ${actual}, correctly labelled ${declared}`, extras);
    }

    /*
     * The magic number is unrecognised. If the endpoint nonetheless claims to be an image, that is a
     * defect — it is serving something that is not the image it advertises. If it claims a non-image
     * type (a URL, a document), that is outside this validator's remit and passes.
     */
    if ((declared ?? '').startsWith('image/')) {
      return outcome.failed(
        `Content-Type claims ${declared} but the body is not a recognised image format`,
        extras,
      );
    }
    return outcome.passed(`non-image binary body served as ${declared ?? 'untyped'}`, extras);
  },
});
