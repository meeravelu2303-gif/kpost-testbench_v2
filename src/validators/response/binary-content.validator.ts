import { defineValidator } from '@engine/validator';
import { outcome } from '@engine/validation-result';
import { hasNoContent, mediaType } from '../support';

/**
 * For binary responses: compares the body's magic number to the declared Content-Type. No content
 * (204/404) passes; a mismatched type, or an `image/*` body that is no known image, fails.
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
    // No body means "this account has no image": a pass.
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

    // Unrecognised bytes fail only when the endpoint claims to serve an image.
    if ((declared ?? '').startsWith('image/')) {
      return outcome.failed(
        `Content-Type claims ${declared} but the body is not a recognised image format`,
        extras,
      );
    }
    return outcome.passed(`non-image binary body served as ${declared ?? 'untyped'}`, extras);
  },
});
