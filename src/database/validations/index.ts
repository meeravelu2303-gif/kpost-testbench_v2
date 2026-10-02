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
import { kmailMailPersistedValidation } from './kmail.db';

/**
 * Endpoint-specific DB validations, referenced from `database: { validations: [...] }`.
 *
 * Three families, deliberately kept apart:
 *
 *  - **`users.db` / `companies.db`** validate the **mock server's** idealised schema (`users`,
 *    `id`, `createdAt`, `deletedAt`) and are attached only to `mockFixture` endpoints. They are
 *    the framework's own self-tests. Repointing them at KPOST_QA would break those self-tests and
 *    assert nothing about the product, because no real endpoint references them.
 *  - **`kpost.db`** validates the **real KPOST_QA schema** — `TBL_KPOST_USER_MASTER`,
 *    `TBL_KPOST_USER_PROFILE`, `TBL_KPOST_KATCHUP_MESSAGES`, `TBL_KPOST_LOGIN_SESSION`,
 *    `TBL_KPOST_ADMIN_REGISTRATION` — and is attached to real endpoints.
 *  - **`kmail.db`** validates the real KMail tables (`TBL_KPOST_KMAIL_MASTER`/`_TRANSACTION`).
 *    Added 2026-10-02 — see `TEST_BENCH_100_PERCENT_PLAN.md` §16 P0 item 2: not yet independently
 *    executable (every DB validation reports SKIPPED until `DB_SSL_CA` is supplied), written now so
 *    it is ready the moment that's resolved.
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
  // --- Real KMail persistence ------------------------------------------------------------------
  kmailMailPersistedValidation,
);
