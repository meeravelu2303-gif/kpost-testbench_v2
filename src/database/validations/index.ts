import { DatabaseValidationRegistry } from '../database-validation';
import { companyCreatedValidation } from './companies.db';
import { userCreatedValidation, userDeletedValidation, userUpdatedValidation } from './users.db';

/** Endpoint-specific DB validations, referenced from `database: { validations: [...] }`. */
export const databaseValidationRegistry = new DatabaseValidationRegistry().register(
  userCreatedValidation,
  userUpdatedValidation,
  userDeletedValidation,
  companyCreatedValidation,
);
