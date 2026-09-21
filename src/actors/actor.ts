import type { PooledAccount } from '../test-data/account-pool';
import type { ActorRoleId } from './role';

/**
 * Actor — a logical participant in one run of a business flow.
 *
 * ## The four concepts, kept distinct
 *
 *     ActorRole   a semantic part in a flow            ('sender')            src/actors/role.ts
 *     Actor       a logical participant playing it     (sender#0)           THIS FILE
 *     Account     the bench's account representation   (PooledAccount)      src/test-data/account-pool.ts
 *     Session     the authenticated session            (token / storageState) src/api/client/token-provider.ts
 *
 * They are deliberately NOT merged. An actor is not an account: the same flow run may bind `sender`
 * to different accounts on different slots, and a role may be played with no account at all while a
 * flow is still being designed. An account is not a session: the account exists before anyone logs
 * in, and the session is minted later, by the existing `TokenProvider`.
 *
 * ## What this file does not do
 *
 * No permissions, no capabilities, no `canSend()` / `canRecall()` / `canAdmin()`. An `Actor` says who
 * is acting; what they may do is the future Business Invariant Model's question. Nothing here is
 * allowed to grow a predicate about allowed behaviour.
 *
 * It also creates no account and no session. It **references** the existing `PooledAccount` and
 * stops there — see `ActorAccountBinding`.
 */

/**
 * A logical participant.
 *
 * `actorId` is stable within one `ActorContext`: resolving the same role twice returns the same
 * actor, so a flow whose steps go sender → sender → recipient → sender refers to two participants,
 * not four.
 */
export interface Actor {
  /** Stable within a context: `<roleId>#<instance>`, e.g. `sender#0`, `group-member#2`. */
  readonly actorId: string;
  readonly role: ActorRoleId;
  /**
   * Which participant of this role, when a flow needs more than one (a group with three members).
   * Zero for the common one-per-role case.
   */
  readonly instance: number;
}

/**
 * The binding of an actor to an existing account — the ONE place the Actor Model meets the account
 * infrastructure.
 *
 * It holds a `PooledAccount` produced by the existing `AccountPool`. No account is created here, no
 * credential is stored here, and no second pool exists. `PooledAccount` already keeps its principal
 * non-enumerable with a redacting `toJSON`, so binding an actor cannot leak a credential into a
 * report.
 *
 * ## Why there is no `session` field
 *
 * A session is the product of an authentication CALL: the API session is a token minted by
 * `TokenProvider.tokenFor(principal, profile)`, and the UI session is a `storageState` file written
 * by `tests/setup/auth*.setup.ts`. Obtaining either is execution, which this phase excludes.
 *
 * So the session boundary is expressed as a type, not implemented: an actor bound to an account has
 * everything the existing executor needs — `binding.account.principal` is exactly what
 * `SendOptions.auth = { principal }` already accepts. A future execution phase passes it across;
 * nothing new is required on this side, and nothing is duplicated.
 */
export interface ActorAccountBinding {
  readonly actor: Actor;
  readonly account: PooledAccount;
  /** How the binding was made, for reports. Never a credential. */
  readonly boundBy: 'explicit' | 'slot';
}

/** The stable id for a role/instance pair. Deterministic: the same inputs always give the same id. */
export function actorIdFor(role: ActorRoleId, instance = 0): string {
  return `${role}#${instance}`;
}

/** Report-safe projection of a binding: role, actor id and the account KEY, never the credential. */
export function describeBinding(binding: ActorAccountBinding): {
  actorId: string;
  role: ActorRoleId;
  accountKey: string;
  boundBy: string;
} {
  return {
    actorId: binding.actor.actorId,
    role: binding.actor.role,
    accountKey: binding.account.key,
    boundBy: binding.boundBy,
  };
}
