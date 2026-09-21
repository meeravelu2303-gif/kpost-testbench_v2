import type { PooledAccount } from '../test-data/account-pool';
import { actorIdFor, type Actor, type ActorAccountBinding } from './actor';
import { actorRole, isActorRoleId, type ActorRoleId } from './role';

/**
 * ActorContext — the actors of ONE flow run, and their account bindings.
 *
 * ## Isolation is structural, not conventional
 *
 * There is **no module-level actor state in this file**. Every actor and every binding lives inside
 * an instance, so a second run cannot inherit a first run's actors, accounts or bindings: the only
 * way to obtain them is to hold the same `ActorContext`. This is the same rule Phase 2B applied to
 * flow artifacts, and for the same reason — the mechanism it replaces (a module-level `let` shared
 * between serial tests) is exactly how state leaks between runs today.
 *
 * ## Deterministic identity
 *
 * `actor('sender')` returns the *same* `Actor` object every time within one context. A flow whose
 * steps are sender → sender → recipient → sender therefore involves two participants, not four, and
 * the identity is stable without anyone threading a variable through the steps.
 *
 * ## What this class must never gain
 *
 * No permission check, no capability, no business rule. It answers WHO; it must never grow an
 * opinion about what that actor may do.
 */

export class ActorContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActorContextError';
  }
}

export class ActorContext {
  /** actorId → the one Actor instance for that role/instance pair. Per context; never shared. */
  private readonly actors = new Map<string, Actor>();
  /** actorId → its account binding. Per context; never shared. */
  private readonly bindings = new Map<string, ActorAccountBinding>();
  /** The roles this context is allowed to resolve. */
  private readonly allowed: ReadonlySet<ActorRoleId>;

  /**
   * @param roles the roles this context may resolve — normally a flow's declared `actorRoles`.
   *              An empty list means "any registered role", for a context not tied to a flow.
   */
  constructor(roles: readonly ActorRoleId[] = []) {
    for (const declared of roles) {
      // Widened to `string` on purpose. TypeScript proves the parameter is already an `ActorRoleId`
      // and would make the failing branch unreachable — but a context built from JSON, or from a
      // value cast at a boundary, never saw that check. The guard stays, and is reachable.
      const role: string = declared;
      if (!isActorRoleId(role)) {
        throw new ActorContextError(
          `"${role}" is not a registered actor role. Add it to ACTOR_ROLE_DEFINITIONS with its ` +
            'provenance, or fix the reference — a role may not be invented at the call site.',
        );
      }
    }
    this.allowed = new Set(roles);
  }

  /** The roles this context may resolve. Empty means unrestricted. */
  declaredRoles(): ActorRoleId[] {
    return [...this.allowed];
  }

  private assertResolvable(role: string): asserts role is ActorRoleId {
    if (!isActorRoleId(role)) {
      throw new ActorContextError(
        `"${role}" is not a registered actor role — an arbitrary string cannot become a role.`,
      );
    }
    if (this.allowed.size > 0 && !this.allowed.has(role)) {
      throw new ActorContextError(
        `role "${role}" is not declared by this context (declared: ` +
          `${[...this.allowed].join(', ') || 'none'}). Declare it on the flow before using it.`,
      );
    }
  }

  /**
   * The actor playing a role.
   *
   * Deterministic and memoised: the same role (and instance) always yields the same `Actor`.
   *
   * @param instance which participant of this role, for flows needing more than one — a group send
   *                 addresses several `group-member` actors. Defaults to the single-participant case.
   */
  actor(role: ActorRoleId, instance = 0): Actor {
    this.assertResolvable(role);
    if (!Number.isInteger(instance) || instance < 0) {
      throw new ActorContextError(`actor instance must be a non-negative integer, got ${instance}`);
    }
    const actorId = actorIdFor(role, instance);
    const existing = this.actors.get(actorId);
    if (existing) return existing;

    const created: Actor = { actorId, role, instance };
    this.actors.set(actorId, created);
    return created;
  }

  /** Every actor resolved so far, in resolution order. */
  actors_(): Actor[] {
    return [...this.actors.values()];
  }

  /**
   * Binds an actor to an existing account.
   *
   * The account must come from the existing `AccountPool` — this method creates none, and the Actor
   * Model has no account of its own. Re-binding the same actor to a different account is refused:
   * an actor's identity within a run is fixed, and silently swapping the account underneath it is
   * how a cross-account test starts asserting against the wrong session.
   */
  bindAccount(
    role: ActorRoleId,
    account: PooledAccount,
    options: { instance?: number; boundBy?: ActorAccountBinding['boundBy'] } = {},
  ): ActorAccountBinding {
    const actor = this.actor(role, options.instance ?? 0);
    const existing = this.bindings.get(actor.actorId);
    if (existing) {
      if (existing.account.key === account.key) return existing;
      throw new ActorContextError(
        `actor "${actor.actorId}" is already bound to account "${existing.account.key}" and cannot ` +
          `be rebound to "${account.key}" — an actor's account is fixed for the life of a run.`,
      );
    }
    const binding: ActorAccountBinding = {
      actor,
      account,
      boundBy: options.boundBy ?? 'explicit',
    };
    this.bindings.set(actor.actorId, binding);
    return binding;
  }

  /** The binding for a role, or `undefined` when the actor has no account yet. */
  binding(role: ActorRoleId, instance = 0): ActorAccountBinding | undefined {
    this.assertResolvable(role);
    return this.bindings.get(actorIdFor(role, instance));
  }

  /** The account bound to a role, or `undefined`. */
  accountFor(role: ActorRoleId, instance = 0): PooledAccount | undefined {
    return this.binding(role, instance)?.account;
  }

  /** Whether an actor has an account. */
  isBound(role: ActorRoleId, instance = 0): boolean {
    return this.binding(role, instance) !== undefined;
  }

  /** Every binding made in this context. */
  allBindings(): ActorAccountBinding[] {
    return [...this.bindings.values()];
  }

  /**
   * Roles that still need an account before the run could execute.
   *
   * Reads `requiredAccountUse` from the role definition: a role the bench must log in as needs a
   * binding, a `reference` role does not. This is an infrastructure readiness question, never a
   * permission question.
   */
  unboundSessionRoles(): ActorRoleId[] {
    return this.declaredRoles().filter((role) => {
      const definition = actorRole(role);
      return definition?.requiredAccountUse === 'session' && !this.isBound(role);
    });
  }
}
