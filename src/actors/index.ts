/**
 * The Actor Model — WHO performs or observes a business action.
 *
 * Phase 3. A minimal foundation layer that names participants and, where the infrastructure allows,
 * binds them to accounts the bench already owns:
 *
 *     ActorRole   a semantic part in a flow            ('sender')
 *     Actor       a logical participant playing it     (sender#0)
 *     Account     the existing PooledAccount           src/test-data/account-pool.ts
 *     Session     the existing token / storageState    src/api/client/token-provider.ts
 *
 * ## What this layer owns
 *
 *  - a closed, provenance-cited role vocabulary, so a role cannot be invented at a call site;
 *  - deterministic, per-run actor identity (`ActorContext`), with no global mutable state;
 *  - the binding of an actor to an EXISTING pooled account.
 *
 * ## What this layer does NOT own, and must never gain
 *
 * No permission, capability or business rule — no `canSend()`, `canRecall()`, `canAdmin()`, no
 * permission matrix. The Actor Model answers who is acting; what an actor may do is the future
 * Business Invariant Model's question, answered from requirements and evidence.
 *
 * It also creates no account pool, no authentication system and no session. It imports nothing from
 * Bugzilla, the confidence gate, the reporters, the failure classifier, the validators or the
 * endpoint definitions — a guard in `tests/framework/actor-model.spec.ts` asserts that.
 */

export {
  ACTOR_ROLE_DEFINITIONS,
  ACTOR_ROLE_IDS,
  EXCLUDED_ROLE_CANDIDATES,
  actorRole,
  isActorRoleId,
  rolesForModule,
  type ActorRoleDefinition,
  type ActorRoleId,
} from './role';

export { actorIdFor, describeBinding, type Actor, type ActorAccountBinding } from './actor';

export { ActorContext, ActorContextError } from './context';
