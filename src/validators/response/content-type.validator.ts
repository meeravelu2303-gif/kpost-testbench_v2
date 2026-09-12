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
    return mediaType(actual) === mediaType(endpoint.contentType)
      ? outcome.passed(`Content-Type ${actual}`, extras)
      : outcome.failed(
          `expected ${endpoint.contentType}, got ${actual ?? 'no Content-Type header'}`,
          extras,
        );
  },
});
