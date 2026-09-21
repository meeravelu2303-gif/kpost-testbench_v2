import type { ActorRoleId } from '../actors/role';
import type { Provenance } from './provenance';
import type { StateResourceId } from './vocabulary';

/**
 * StateTransition — a documented change of application state.
 *
 *     FROM STATE  ──►  ACTION  ──►  TO STATE
 *
 * Phase 4B. Declarative only: nothing here causes a transition, and nothing here asserts one
 * happened. A transition record says *the documentation describes this change*, cites where, and
 * names the actor the documentation names.
 *
 * ## Actor semantics, stated once
 *
 * `actor` means **"the actor the documentation describes performing this action"**. It does NOT mean
 * "this actor is authorized to perform it", and it must never be read that way. Whether a given
 * actor/action/state combination is *permitted* is the future Business Invariant Model's question —
 * for example BR-KU-RECALL-UNREAD (recall is allowed only before the recipient has read the message)
 * is a rule ABOUT a transition and a state, and is deliberately not expressible here.
 *
 * Accordingly this file contains no `canSend`/`canRead`/`canRecall`/`canEdit`/`canDelete`/`canAdmin`
 * and no predicate of any kind, and a framework guard asserts it stays that way.
 */

/**
 * What makes the transition happen — the distinction Phase 4A established as load-bearing.
 *
 * The read of a 1:1 Katchup message is the motivating case: the transition is real and documented,
 * the resulting state is observable through an endpoint the bench already calls, but **no endpoint
 * causes it**. The web client marks a thread read as a side effect of opening the conversation.
 * Collapsing that into "no transition" would be wrong, and inventing an endpoint would be worse — so
 * the mechanism is recorded as `UI` with the reason attached.
 */
export const TRANSITION_MECHANISMS = [
  /** A registered endpoint performs it; `endpointId` is required. */
  'API',
  /** Only a UI action performs it. `unavailableReason` is required. */
  'UI',
  /** The application performs it on a timer, with no actor. `unavailableReason` is required. */
  'TIME',
  /** Documented as happening, with no stated mechanism. `unavailableReason` is required. */
  'UNKNOWN',
] as const;
export type TransitionMechanism = (typeof TRANSITION_MECHANISMS)[number];

export interface StateTransition {
  /** Stable id, e.g. `katchup.message.send`. */
  readonly transitionId: string;
  readonly resource: StateResourceId;
  /**
   * The `stateId` the resource leaves, or `null` when the action creates the resource.
   * `null` is used rather than a synthetic `NONEXISTENT` state so nothing has to invent a state the
   * application does not document.
   */
  readonly from: string | null;
  /** The channel-independent business action, e.g. `katchup.send-message`. */
  readonly action: string;
  /** The `stateId` the resource reaches. */
  readonly to: string;
  /**
   * The actor the documentation names, if it names one. Absent when the sources do not agree or do
   * not say — recorded as absent rather than guessed.
   */
  readonly actor?: ActorRoleId;
  /** Ids from the Phase 1 Requirement Registry. Ids only; requirement text is never copied. */
  readonly requirementIds: readonly string[];
  readonly mechanism: TransitionMechanism;
  /** The registered endpoint id, required when `mechanism` is `API`. A string, so no API import. */
  readonly endpointId?: string;
  /** Why the bench cannot drive this transition, required when `mechanism` is not `API`. */
  readonly unavailableReason?: string;
  readonly provenance: Provenance;
}
