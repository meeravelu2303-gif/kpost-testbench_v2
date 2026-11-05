import { defineValidator } from '@engine/validator';
import { outcome } from '@engine/validation-result';
import { hasNoContent, mediaType } from '../support';

export const contentTypeValidator = defineValidator({
  name: 'response.content-type',
  category: 'RESPONSE',
  severity: 'HIGH',
  description: "Content-Type matches the endpoint's configured media type",
  toggle: 'contentType',
  appliesTo: ({ primary }) =>
    hasNoContent(primary) ? `response has no content (HTTP ${primary.status})` : true,
  check: ({ primary, endpoint }) => {
    const actual = primary.contentType;
    const extras = { expected: endpoint.contentType, actual: actual ?? '(missing)' };
    // A `type/*` config accepts any subtype — an image endpoint legitimately returns the format the
    // user uploaded (png OR jpeg), so `image/*` is the real contract, not a hard-coded subtype.
    const configured = endpoint.contentType ?? '';
    // `*/*`: a file download serves each file in its own stored type (S3 metadata), so any real
    // Content-Type is right; a missing one is still wrong (response.binary-content checks the bytes).
    const matches =
      configured === '*/*'
        ? Boolean(mediaType(actual))
        : configured.endsWith('/*')
          ? (mediaType(actual) ?? '').split('/')[0] === configured.split('/')[0]
          : mediaType(actual) === mediaType(configured);
    return matches
      ? outcome.passed(`Content-Type ${actual}`, extras)
      : outcome.failed(
          `expected ${endpoint.contentType}, got ${actual ?? 'no Content-Type header'}`,
          extras,
        );
  },
});
