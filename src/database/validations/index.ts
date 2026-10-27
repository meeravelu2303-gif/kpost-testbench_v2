import { DatabaseValidationRegistry } from '../database-validation';
import {
  companyLicenceIntegrityValidation,
  katchupMessagePersistedValidation,
  kpostProfileUpdatedValidation,
  kpostUserActiveValidation,
  loginSessionCreatedValidation,
  settingsPersistedValidation,
} from './kpost.db';
import { kmailMailPersistedValidation } from './kmail.db';

/**
 * Endpoint-specific DB validations (`database: { validations: [...] }`), for the KPOST_QA and KMail
 * tables. They report SKIPPED, never PASSED, while the database is unreachable.
 */
export const databaseValidationRegistry = new DatabaseValidationRegistry().register(
  // --- KPOST_QA persistence --------------------------------------------------------------------
  kpostUserActiveValidation,
  kpostProfileUpdatedValidation,
  katchupMessagePersistedValidation,
  loginSessionCreatedValidation,
  companyLicenceIntegrityValidation,
  settingsPersistedValidation,
  // --- KMail persistence -----------------------------------------------------------------------
  kmailMailPersistedValidation,
);
