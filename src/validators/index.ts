import { ValidationRegistry } from '@engine/validation-registry';
import { expiredTokenValidator } from './authentication/expired-token.validator';
import { invalidTokenValidator } from './authentication/invalid-token.validator';
import { malformedTokenValidator } from './authentication/malformed-token.validator';
import { missingTokenValidator } from './authentication/missing-token.validator';
import { validTokenValidator } from './authentication/valid-token.validator';
import { crossResourceAccessValidator } from './authorization/cross-resource-access.validator';
import { forbiddenValidator } from './authorization/forbidden.validator';
import { permissionValidator } from './authorization/permission.validator';
import { privilegeEscalationValidator } from './authorization/privilege-escalation.validator';
import { roleValidator } from './authorization/role.validator';
import { booleanValidator } from './common/boolean.validator';
import { burstResilienceValidator } from './concurrency/burst-resilience.validator';
import { duplicateWriteValidator } from './concurrency/duplicate-write.validator';
import { readConsistencyValidator } from './concurrency/read-consistency.validator';
import { sessionIsolationValidator } from './concurrency/session-isolation.validator';
import { commonErrorValidator } from './common/common-error.validator';
import { dateValidator } from './common/date.validator';
import { emailValidator } from './common/email.validator';
import { idValidator } from './common/id.validator';
import { urlValidator } from './common/url.validator';
import { payloadSizeValidator } from './performance/payload-size.validator';
import { responseTimeValidator } from './performance/response-time.validator';
import { timeoutValidator } from './performance/timeout.validator';
import { boundaryValueValidator } from './request/boundary-value.validator';
import { dataTypeValidator } from './request/data-type.validator';
import { emptyValueValidator } from './request/empty-value.validator';
import { enumValidator } from './request/enum.validator';
import { formatValidator } from './request/format.validator';
import { invalidPayloadValidator } from './request/invalid-payload.validator';
import {
  emptyBodyValidator,
  methodNotAllowedValidator,
  unsupportedMediaTypeValidator,
} from './request/error-shape.validator';
import { malformedJsonValidator } from './request/malformed-json.validator';
import { nullValueValidator } from './request/null-value.validator';
import { requiredFieldsValidator } from './request/required-fields.validator';
import { unknownFieldsValidator } from './request/unknown-fields.validator';
import { binaryContentValidator } from './response/binary-content.validator';
import { contentTypeValidator } from './response/content-type.validator';
import { errorFormatValidator } from './response/error-format.validator';
import { headersValidator } from './response/headers.validator';
import { metadataValidator } from './response/metadata.validator';
import { paginationValidator } from './response/pagination.validator';
import { responseSchemaValidator } from './response/response-schema.validator';
import { responseStructureValidator } from './response/response-structure.validator';
import { statusCodeValidator } from './response/status-code.validator';
import { informationDisclosureValidator } from './security/information-disclosure.validator';
import { injectionValidator } from './security/injection.validator';
import { jwtValidator } from './security/jwt.validator';
import { rateLimitValidator } from './security/rate-limit.validator';
import { securityHeadersValidator } from './security/security-headers.validator';
import { sensitiveDataValidator } from './security/sensitive-data.validator';
import { xssValidator } from './security/xss.validator';

/**
 * THE place where centralized validators are registered. Adding one line here applies a new
 * validator to every registered endpoint — no endpoint definition or spec file changes.
 * Order within a stage is execution order.
 */
export const validationRegistry = new ValidationRegistry().register(
  // Response
  statusCodeValidator,
  contentTypeValidator,
  binaryContentValidator,
  headersValidator,
  responseStructureValidator,
  responseSchemaValidator,
  metadataValidator,
  paginationValidator,
  errorFormatValidator,
  // Performance (functional latency budgets — not load testing)
  timeoutValidator,
  responseTimeValidator,
  payloadSizeValidator,
  // Authentication
  validTokenValidator,
  missingTokenValidator,
  invalidTokenValidator,
  expiredTokenValidator,
  malformedTokenValidator,
  // Authorization
  roleValidator,
  permissionValidator,
  forbiddenValidator,
  crossResourceAccessValidator,
  privilegeEscalationValidator,
  // Request (negative cases derived from the request contract)
  requiredFieldsValidator,
  nullValueValidator,
  emptyValueValidator,
  dataTypeValidator,
  boundaryValueValidator,
  enumValidator,
  formatValidator,
  unknownFieldsValidator,
  invalidPayloadValidator,
  malformedJsonValidator,
  methodNotAllowedValidator,
  unsupportedMediaTypeValidator,
  emptyBodyValidator,
  // Security
  securityHeadersValidator,
  jwtValidator,
  injectionValidator,
  xssValidator,
  rateLimitValidator,
  informationDisclosureValidator,
  sensitiveDataValidator,
  /*
   * Concurrency — the faults that need two requests inside the handler at once. Placed after
   * security because they are the most expensive probes in the suite (each one is a burst), and a
   * cheap check that will fail anyway should fail first.
   */
  readConsistencyValidator,
  burstResilienceValidator,
  duplicateWriteValidator,
  sessionIsolationValidator,
  // Common data conventions
  idValidator,
  emailValidator,
  dateValidator,
  urlValidator,
  booleanValidator,
  commonErrorValidator,
);
