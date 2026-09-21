import type { Provenance } from './provenance';

/**
 * StateVocabulary — the documented state terminology of one application resource.
 *
 * Phase 4B. This is a **description of the application**, not of a test run. It says what states
 * KPOST documents for a resource, in the resource's own words, with the evidence attached. It holds
 * no runtime value, performs no call, and judges nothing.
 *
 * ## The rule about normalisation
 *
 * The repository's state terminology is genuinely inconsistent — the same idea appears as a numeric
 * code, a string label, a `Y`/`N` flag and a boolean, sometimes under different field names for the
 * same endpoint. **Nothing here tidies that up.** Each state records the literal term, the literal
 * raw value and the literal field that carries it, exactly as the source spells them. Where two
 * sources disagree the disagreement becomes a `StateConflict`; it is never averaged away, because a
 * model that silently picks one spelling would make the bench assert against a field the application
 * may not return.
 */

/**
 * The resource families this phase models. Deliberately three, matching the Phase 4A evidence.
 *
 * Group is **excluded**: the documented API contains no group read endpoint (every `/v2/group/*` path
 * is a mutation or an image download) and group mutations answer with prose, so a declared group
 * state could never be confirmed. KDiary, attachments and drafts are excluded for want of a usable
 * vocabulary. Those omissions are decisions, recorded in the Phase 4A discovery, not oversights.
 */
export const STATE_RESOURCES = ['katchup.message', 'kall', 'kmail.transaction'] as const;
export type StateResourceId = (typeof STATE_RESOURCES)[number];

/**
 * How a state value is physically represented in the API.
 *
 * Kept explicit because it is the thing most likely to be wrong at the point of use: reading
 * `status === 2` when the endpoint returns `"Read"` fails silently, and the repository documents both
 * forms for the same Kall endpoint (see `STATE_CONFLICTS`).
 */
export const STATE_REPRESENTATIONS = [
  /** An integer from a closed enum, e.g. `status: 2`. */
  'NUMERIC_CODE',
  /** A human label in the payload, e.g. `kallStatus: "Scheduled"`. */
  'STRING_LABEL',
  /** The `"Y"` / `"N"` convention used by group membership and every KMail transaction flag. */
  'YN_FLAG',
  /** A real boolean, e.g. `isVanished: false`. */
  'BOOLEAN_FLAG',
  /** The state is carried by a timestamp being present rather than null, e.g. `readTime`. */
  'TIMESTAMP_PRESENCE',
  /** The state is carried by an identifier being present rather than null, e.g. `deletedBy`. */
  'ACTOR_REFERENCE',
] as const;
export type StateRepresentation = (typeof STATE_REPRESENTATIONS)[number];

/**
 * What the value actually *means* — the distinction Phase 4A found being lost.
 *
 * `katchupStatus` mixes a message's delivery/read lifecycle (`0 Sent`, `1 Unread`, `2 Read`,
 * `3 Not sent`) with a conversation-kind discriminator (`4 Group`, which the bench sends as a routing
 * value). Treating all five as one lifecycle enum would imply a group message can be `Read`, which
 * the field cannot express. `role` keeps the two apart without renumbering anything.
 */
export const STATE_ROLES = [
  /** A position in the resource's lifecycle. Transitions move between these. */
  'LIFECYCLE',
  /** Classifies WHAT the row is, not what has happened to it. Never a transition target. */
  'CLASSIFIER',
  /** An independent fact layered on top of the lifecycle (important, vanishing, deleted-by). */
  'MARKER',
  /** The term exists but no source says what it means. */
  'UNKNOWN',
] as const;
export type StateRole = (typeof STATE_ROLES)[number];

/** Whether the state belongs to the resource itself or to one participant's view of it. */
export const STATE_SCOPES = ['RESOURCE', 'PER_PARTICIPANT'] as const;
export type StateScope = (typeof STATE_SCOPES)[number];

export interface StateDefinition {
  /** Stable id, `<resource>.<slug>`, e.g. `katchup.message.read`. */
  readonly stateId: string;
  readonly resource: StateResourceId;
  /** The term exactly as the source spells it — `Sent`, `ReScheduled`, `Y`. Never re-cased. */
  readonly term: string;
  /** The literal value as documented, as a string so `0` and `"0"` stay distinguishable. */
  readonly rawValue: string;
  /** The field that carries it, exactly as the response spells it — `status`, `senderKallStatus`. */
  readonly field: string;
  readonly representation: StateRepresentation;
  readonly role: StateRole;
  readonly scope: StateScope;
  /** What it means, in the source's terms. Never a permission and never an expectation. */
  readonly meaning: string;
  readonly provenance: Provenance;
}

/**
 * Which field identifies an instance of the resource.
 *
 * Phase 4C addition. A state value is meaningless without the resource it belongs to — `status = 2`
 * says nothing; `msgID 8101 → status 2` is an observation. Declaring the identity field HERE, beside
 * the states, keeps that knowledge in the resource model rather than scattering it through an
 * extractor, and makes it carry provenance like everything else.
 *
 * Still declarative: this names a field, it does not read one.
 */
export interface ResourceIdentity {
  /** The field carrying the instance id, exactly as the response spells it — `msgID`, `kallID`. */
  readonly field: string;
  /**
   * The enclosing resource's id field, when an instance is only unique within a parent. A KMail
   * transaction is one recipient's copy of one mail, so its `transactionID` is qualified by the
   * mail's `kmailID`.
   */
  readonly parentField?: string;
  readonly provenance: Provenance;
}

export interface StateVocabulary {
  readonly resource: StateResourceId;
  /** The existing module vocabulary (`katchup`, `kall`, `kmail`). */
  readonly module: string;
  readonly describe: string;
  /** How an instance of this resource is identified in a response. */
  readonly identity: ResourceIdentity;
  readonly states: readonly StateDefinition[];
  readonly provenance: Provenance;
}
