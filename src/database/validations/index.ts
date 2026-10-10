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
 * Endpoint-specific DB validations, referenced from `database: { validations: [...] }`.
 *
 * Two families, kept apart because they read different databases:
 *
 *  - **`kpost.db`** validates the **KPOST_QA schema** — `TBL_KPOST_USER_MASTER`,
 *    `TBL_KPOST_USER_PROFILE`, `TBL_KPOST_KATCHUP_MESSAGES`, `TBL_KPOST_LOGIN_SESSION`,
 *    `TBL_KPOST_ADMIN_REGISTRATION`.
 *  - **`kmail.db`** validates the KMail tables (`TBL_KPOST_KMAIL_MASTER`/`_TRANSACTION`).
 *
 * Every validation reports SKIPPED, never PASSED, while the database is unreachable: whether a
 * write actually landed is exactly what the API response cannot prove on its own.
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
