import { apiConfig } from '@config/api.config';
import { createFieldConventionValidator } from './field-convention';

/**
 * `*Id` fields that are business/reference identifiers with their own shape (a company number, an
 * employee code, an e-mail), not the platform id format.
 */
const NOT_PLATFORM_ID = /^(companyId|countryId|employeeId|ksmaccCompanyID|emailId)$/i;

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
    // Reference ids have their own shape, and "0"/"" means "no reference".
    if (NOT_PLATFORM_ID.test(visit.key) || isAbsentId(value)) return undefined;
    const { pattern, description } = context.endpoint.contract.idFormat;
    return pattern.test(String(value)) ? undefined : `not ${description}`;
  },
});
