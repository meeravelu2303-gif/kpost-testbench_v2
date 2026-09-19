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
    const matches = configured.endsWith('/*')
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
