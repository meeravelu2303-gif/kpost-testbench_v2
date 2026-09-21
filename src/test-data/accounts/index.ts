/**
 * The Test Bench account registry — persistent knowledge of the accounts automation created.
 *
 * ## Where it sits
 *
 *     AccountRegistry   which accounts EXIST, where, and their bench lifecycle   (this module)
 *            │ identity
 *            ▼
 *     AccountPool       which accounts a slot may log in as, and credentials     (unchanged)
 *            │ credentials / runtime binding
 *            ▼
 *     ActorContext      which account plays which role in one flow run           (unchanged)
 *            │
 *            ▼
 *     flow execution
 *
 * The registry is the top of that chain and the thinnest part of it. It replaces nothing: the pool
 * still owns credentials and slot partitioning, the resource ledger still owns per-run cleanup, and
 * `ActorContext` still decides who plays what. This module adds only the piece none of them had —
 * knowledge that survives the run.
 *
 * ## What it never contains
 *
 * No credential of any kind, no API call, no Playwright, no signup logic, no state observation, no
 * Bugzilla, no confidence, no failure classification. It stores identity, and `assertNoSecrets`
 * refuses anything secret-shaped at the write boundary rather than trusting review.
 *
 * ## Direction
 *
 *     signup flow  ──►  AccountRegistry        and never the reverse.
 *
 * A flow calls `register()` after the APPLICATION has confirmed a creation. The registry has no idea
 * what signup is, which is what keeps it reusable by any future flow that mints an account.
 */

export {
  ACCOUNT_SOURCES,
  FORBIDDEN_ACCOUNT_KEYS,
  TEST_ACCOUNT_STATUSES,
  TestAccountError,
  accountKey,
  allowedTransitionsFrom,
  assertNoSecrets,
  canTransition,
  isTestAccountStatus,
  type AccountSource,
  type TestAccountRecord,
  type TestAccountStatus,
} from './account-record';

export {
  AccountRegistry,
  InMemoryAccountStore,
  type AccountRegistration,
  type AccountStore,
} from './account-registry';

export {
  AccountStoreError,
  JsonlAccountStore,
  parseAccountLines,
  type AccountStoreProblem,
} from './account-store';

export { assertSameEnvironment, environmentOf, matchesEnvironment } from './environment';
