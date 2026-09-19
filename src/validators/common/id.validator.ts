import { apiConfig } from '@config/api.config';
import { createFieldConventionValidator } from './field-convention';

/**
 * `*Id` field names that are NOT the platform's primary-key id format — they are business / reference
 * identifiers with their own shape, so holding them to the ObjectId/UUID pattern is a false positive:
 *   - `companyId` (a company number, e.g. "242"), `countryId` (a reference number, e.g. 1),
 *   - `employeeId` (a human-readable code, e.g. "EMP3411ES").
 * Measured from the live admin responses; see the 2026-09-19 decision-log entry.
 */
const NOT_PLATFORM_ID = /^(companyId|countryId|employeeId|ksmaccCompanyID)$/i;

/** A `*Id` value that means "no reference", not a malformed id — never a defect. */
function isAbsentId(value: unknown): boolean {
  const s = String(value).trim();
  return s === '' || s === '0';
}

export const idValidator = createFieldConventionValidator({
  name: 'common.id',
  noun: 'ID',
  description: 'ID fields (`id`, `*Id`) use the platform ID format',
  field: apiConfig.dataConventions.id.field,
  // The shape of an identifier is a property of the API - see src/config/response-contract.ts.
  check: (value, visit, context) => {
    // Business/reference ids (companyId, countryId, employeeId) have their own shape, and a "0"/""
    // value is the "no reference" sentinel — neither is the platform id format, so neither is a defect.
    if (NOT_PLATFORM_ID.test(visit.key) || isAbsentId(value)) return undefined;
    const { pattern, description } = context.endpoint.contract.idFormat;
    return pattern.test(String(value)) ? undefined : `not ${description}`;
  },
});
