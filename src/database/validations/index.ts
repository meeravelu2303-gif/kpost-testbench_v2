import { DatabaseValidationRegistry } from '../database-validation';
import { companyCreatedValidation } from './companies.db';
import {
  companyLicenceIntegrityValidation,
  katchupMessagePersistedValidation,
  kpostProfileUpdatedValidation,
  kpostUserActiveValidation,
  loginSessionCreatedValidation,
  settingsPersistedValidation,
} from './kpost.db';
import { userCreatedValidation, userDeletedValidation, userUpdatedValidation } from './users.db';

/**
 * Endpoint-specific DB validations, referenced from `database: { validations: [...] }`.
 *
 * Two families, deliberately kept apart:
 *
 *  - **`users.db` / `companies.db`** validate the **mock server's** idealised schema (`users`,
 *    `id`, `createdAt`, `deletedAt`) and are attached only to `mockFixture` endpoints. They are
 *    the framework's own self-tests. Repointing them at KPOST_QA would break those self-tests and
 *    assert nothing about the product, because no real endpoint references them.
 *  - **`kpost.db`** validates the **real KPOST_QA schema** — `TBL_KPOST_USER_MASTER`,
 *    `TBL_KPOST_USER_PROFILE`, `TBL_KPOST_KATCHUP_MESSAGES`, `TBL_KPOST_LOGIN_SESSION`,
 *    `TBL_KPOST_ADMIN_REGISTRATION` — and is attached to real endpoints.
 */
export const databaseValidationRegistry = new DatabaseValidationRegistry().register(
  // --- Mock-fixture self-tests ----------------------------------------------------------------
  userCreatedValidation,
  userUpdatedValidation,
  userDeletedValidation,
  companyCreatedValidation,
  // --- Real KPOST_QA persistence --------------------------------------------------------------
  kpostUserActiveValidation,
  kpostProfileUpdatedValidation,
  katchupMessagePersistedValidation,
  loginSessionCreatedValidation,
  companyLicenceIntegrityValidation,
  settingsPersistedValidation,
);
