import { fieldLimits, filler, isIdentifierField, itemsOf } from './boundary-value.validator';
import { createRequestValidator, type Candidate, type MutationStrategy } from './request-mutation';

/** The longest edge value this validator stores; longer limits are tested from outside only. */
const MAX_EDGE_LENGTH = 20_000;

/** The values exactly at each limit (also sent by `boundaryInFlow` for shared-state writes). */
export const boundaryAcceptStrategy: MutationStrategy = (field, current) => {
  const s = field.schema;
  if (field.isRoot && s.type !== 'array') return [];
  const { minLength, maxLength, minimum, maximum, minItems, maxItems } = fieldLimits(s);
  const candidates: Candidate[] = [];
  const add = (label: string, value: unknown) => {
    if (value !== undefined && JSON.stringify(value) !== JSON.stringify(current))
      candidates.push({ label, value });
  };

  // A huge edge (KMail's 200 KB bulk body) would really be stored and mailed; its over-limit
  // case in request.boundary-value is the test that matters there.
  if (maxLength !== undefined && maxLength <= MAX_EDGE_LENGTH)
    add(`length ${maxLength} (maxLength)`, filler(maxLength, current));
  if (minLength !== undefined && minLength > 0)
    add(`length ${minLength} (minLength)`, filler(minLength, current));
  // An id's edge value (kallID 1) is a record that is not ours: never sent.
  if (!isIdentifierField(field.path)) {
    if (maximum !== undefined) add(`${maximum} (maximum)`, maximum);
    if (minimum !== undefined) add(`${minimum} (minimum)`, minimum);
  }
  if (maxItems !== undefined) add(`${maxItems} items (maxItems)`, itemsOf(maxItems, current));
  if (minItems !== undefined && minItems > 0)
    add(`${minItems} items (minItems)`, itemsOf(minItems, current));
  return candidates;
};

/**
 * The other side of `request.boundary-value`: a value exactly at a limit is valid, so the server
 * must take it without a 5xx. This is what catches a field whose own check allows more than its
 * database column holds (the QA DB runs in strict mode, so MySQL refuses the longer value and an
 * unhandled error comes back as a 500). A 4xx is not judged: the edge value may still break a
 * business rule the contract does not describe.
 */
export const boundaryAcceptValidator = createRequestValidator({
  name: 'request.boundary-accept',
  description:
    'Values exactly at a min/max length, value or item limit are taken without a server error',
  severity: 'MEDIUM',
  sections: ['body', 'query', 'path'],
  withItems: true,
  cases: 'valid',
  // A valid value really lands: never on an account-wide change (password, access code, devices,
  // roles, company details) or an OTP flow; `request.boundary-value` still covers those.
  onlyWhen: (endpoint) =>
    endpoint.sideEffect !== 'data' || endpoint.otpDependent
      ? 'a valid edge value would really change the account (shared-state or OTP endpoint); request.boundary-value covers its limits'
      : true,
  restoreAfter: true,
  strategy: boundaryAcceptStrategy,
});
